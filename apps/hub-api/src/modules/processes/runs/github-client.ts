// HUB-FR-129 · HUB-BR-30 · HUB-BR-34 · PC2-R07 · PC2-R09 · PC2-R15 · P-c2 · plan §6.5, spec §6 (Hub gọi ra ngoài).
// `fetch` của Bun (không thư viện): tìm/tạo PR + bật auto-merge. Timeout 15 s, KHÔNG theo redirect, trần thân 1 MiB.
// Token chỉ sống trong `token` (lời gọi bọc bởi `useSecret` ở driver) — không log, không rời chuỗi gọi này.
import type { ApplyErrorCode } from "@ai/contracts/hub-admin";
import { mapProviderError, prUrlOk } from "./apply.rules";

const TIMEOUT_MS = 15_000;
const BODY_LIMIT = 1 << 20; // 1 MiB
const BACKOFFS = [1_000, 2_000, 4_000]; // 5xx/mạng: thử lại 3 lần (PC2-R09)
const API_VERSION = "2022-11-28";
const USER_AGENT = "ai-system-hub";

export type GithubEndpoint = { apiUrl: string; webHost: string };
export type GithubRepo = { owner: string; repo: string };

export type OpenPrInput = {
  endpoint: GithubEndpoint;
  repo: GithubRepo;
  branch: string;
  base: string;
  title: string;
  body: string;
  autoMerge: boolean;
  /** Token khoá nguồn — chỉ dùng trong chuỗi gọi này (bọc bởi `useSecret`). */
  token: string;
};

export type OpenPrResult =
  | {
      kind: "ok";
      prNumber: number;
      /** `null` khi `html_url` không hợp lệ (PC2-R15) ⇒ `invalidUrl=true`. */
      prUrl: string | null;
      invalidUrl: boolean;
      autoMerge: "on" | "failed" | null;
    }
  | { kind: "fail"; code: ApplyErrorCode };

type Ctx = {
  apiUrl: string;
  webHost: string;
  repo: GithubRepo;
  branch: string;
  base: string;
  title: string;
  body: string;
  token: string;
};
type PrView = { number: number | null; nodeId: string | null; htmlUrl: string | null };
type Req =
  | { kind: "ok"; json: unknown }
  | { kind: "exists" }
  | { kind: "fail"; code: ApplyErrorCode };

const TOO_BIG = Symbol("too-big");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Đọc thân ≤ `limit` byte; vượt ⇒ huỷ stream, trả `TOO_BIG` (không đọc hết). */
async function readCapped(res: Response, limit: number): Promise<string | typeof TOO_BIG> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return TOO_BIG;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/** 422 "already exists" ⇒ tìm lại PR (PC2-R07). */
function isAlreadyExists(text: string): boolean {
  const j = parseJson(text);
  if (!isObj(j)) return false;
  const msgs = [typeof j.message === "string" ? j.message : ""];
  if (Array.isArray(j.errors))
    for (const e of j.errors) if (isObj(e) && typeof e.message === "string") msgs.push(e.message);
  return msgs.some((m) => /already exists/i.test(m));
}

function headersFor(token: string, withBody: boolean): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": USER_AGENT,
  };
  if (withBody) h["content-type"] = "application/json";
  return h;
}

/** `done` ⇒ kết quả cuối; `waitMs>0` ⇒ chờ rate limit (một lần); `waitMs===0` ⇒ lùi 5xx. */
type Step = { done: Req } | { waitMs: number };
const FAIL = (code: ApplyErrorCode): Req => ({ kind: "fail", code });

/** Phân loại một phản hồi (không vòng lặp): kết quả hoặc tín hiệu thử lại. */
async function classify(res: Response): Promise<Step> {
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    return { done: FAIL("provider_error") };
  }
  const text = await readCapped(res, BODY_LIMIT);
  if (text === TOO_BIG) return { done: FAIL("provider_error") };
  if (res.ok) return { done: { kind: "ok", json: parseJson(text) } };
  const m = mapProviderError({
    status: res.status,
    retryAfter: res.headers.get("retry-after"),
    rateRemaining: res.headers.get("x-ratelimit-remaining"),
    rateReset: res.headers.get("x-ratelimit-reset"),
    nowMs: Date.now(),
    body422AlreadyExists: isAlreadyExists(text),
  });
  if (m.kind === "exists") return { done: { kind: "exists" } };
  if (m.kind === "fail") return { done: FAIL(m.code) };
  return { waitMs: m.waitMs };
}

type Retry = { net: number; rateUsed: boolean };

/** Chờ bao lâu trước khi thử lại: `waitMs>0` (rate) ⇒ một lần; `0` (5xx/mạng) ⇒ lùi 1/2/4 s; hết ⇒ null. */
function retryDelay(r: Retry, waitMs: number): number | null {
  if (waitMs > 0) {
    if (r.rateUsed) return null;
    r.rateUsed = true;
    return waitMs;
  }
  if (r.net >= BACKOFFS.length) return null;
  return BACKOFFS[r.net++] ?? null;
}

/** Một lời gọi provider + thử lại (rate limit ≤ 60 s một lần; 5xx/mạng 1/2/4 s). KHÔNG theo redirect. */
async function request(ctx: Ctx, method: string, path: string, body?: unknown): Promise<Req> {
  const url = `${ctx.apiUrl}${path}`;
  const init: RequestInit = {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: headersFor(ctx.token, body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  const r: Retry = { net: 0, rateUsed: false };
  while (true) {
    const res = await fetch(url, init).catch(() => null);
    const step: Step = res ? await classify(res) : { waitMs: 0 };
    if ("done" in step) return step.done;
    const delay = retryDelay(r, step.waitMs);
    if (delay === null) return FAIL(step.waitMs > 0 ? "rate_limited" : "provider_error");
    await sleep(delay);
  }
}

function parsePr(json: unknown): PrView {
  if (!isObj(json)) return { number: null, nodeId: null, htmlUrl: null };
  return {
    number: typeof json.number === "number" ? json.number : null,
    nodeId: typeof json.node_id === "string" ? json.node_id : null,
    htmlUrl: typeof json.html_url === "string" ? json.html_url : null,
  };
}

/** `GET /repos/{o}/{r}/pulls?head={o}:{branch}&state=open&per_page=1`. */
async function findOpenPr(
  ctx: Ctx,
): Promise<{ kind: "ok"; pr: PrView | null } | { kind: "fail"; code: ApplyErrorCode }> {
  const head = `${ctx.repo.owner}:${ctx.branch}`;
  const path = `/repos/${ctx.repo.owner}/${ctx.repo.repo}/pulls?head=${encodeURIComponent(head)}&state=open&per_page=1`;
  const r = await request(ctx, "GET", path);
  if (r.kind === "fail") return r;
  if (r.kind === "exists") return { kind: "fail", code: "provider_error" };
  const arr = Array.isArray(r.json) ? r.json : [];
  return { kind: "ok", pr: arr.length ? parsePr(arr[0]) : null };
}

/** `POST /repos/{o}/{r}/pulls`. */
async function createPr(
  ctx: Ctx,
): Promise<
  { kind: "ok"; pr: PrView } | { kind: "exists" } | { kind: "fail"; code: ApplyErrorCode }
> {
  const path = `/repos/${ctx.repo.owner}/${ctx.repo.repo}/pulls`;
  const r = await request(ctx, "POST", path, {
    title: ctx.title,
    head: ctx.branch,
    base: ctx.base,
    body: ctx.body,
    draft: false,
    maintainer_can_modify: false,
  });
  if (r.kind === "fail") return r;
  if (r.kind === "exists") return { kind: "exists" };
  return { kind: "ok", pr: parsePr(r.json) };
}

const AUTO_MERGE_MUTATION =
  "mutation($id:ID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH})" +
  "{pullRequest{number}}}";

/** `POST /graphql` bật auto-merge SQUASH; lỗi ⇒ `failed` (PR vẫn mở, PC2-R07). */
async function enableAutoMerge(ctx: Ctx, nodeId: string | null): Promise<"on" | "failed"> {
  if (!nodeId) return "failed";
  const r = await request(ctx, "POST", "/graphql", {
    query: AUTO_MERGE_MUTATION,
    variables: { id: nodeId },
  });
  if (r.kind !== "ok") return "failed";
  const j = r.json;
  if (!isObj(j)) return "failed";
  if (Array.isArray(j.errors) && j.errors.length > 0) return "failed";
  return isObj(j.data) && j.data.enablePullRequestAutoMerge != null ? "on" : "failed";
}

type Resolved = { kind: "ok"; pr: PrView } | { kind: "fail"; code: ApplyErrorCode };

/** PC2-R07 · tìm PR mở; không có thì tạo; 422 "already exists" ⇒ tìm lại. */
async function resolvePr(ctx: Ctx): Promise<Resolved> {
  const found = await findOpenPr(ctx);
  if (found.kind === "fail") return found;
  if (found.pr) return { kind: "ok", pr: found.pr };
  const created = await createPr(ctx);
  if (created.kind === "fail") return created;
  if (created.kind === "ok") return { kind: "ok", pr: created.pr };
  const again = await findOpenPr(ctx);
  if (again.kind === "fail") return again;
  if (!again.pr) return { kind: "fail", code: "provider_error" };
  return { kind: "ok", pr: again.pr };
}

/** PC2-R07/R15 · tìm/tạo PR theo `head`, kiểm `html_url` (https + host), bật auto-merge nếu yêu cầu. */
export async function openPullRequest(input: OpenPrInput): Promise<OpenPrResult> {
  const ctx: Ctx = {
    apiUrl: input.endpoint.apiUrl.replace(/\/+$/, ""),
    webHost: input.endpoint.webHost,
    repo: input.repo,
    branch: input.branch,
    base: input.base,
    title: input.title,
    body: input.body,
    token: input.token,
  };
  const resolved = await resolvePr(ctx);
  if (resolved.kind === "fail") return resolved;
  const pr = resolved.pr;
  if (pr.number == null) return { kind: "fail", code: "provider_error" };
  const prUrl = pr.htmlUrl && prUrlOk(pr.htmlUrl, ctx.webHost) ? pr.htmlUrl : null;
  const autoMerge = input.autoMerge ? await enableAutoMerge(ctx, pr.nodeId) : null;
  return { kind: "ok", prNumber: pr.number, prUrl, invalidUrl: prUrl === null, autoMerge };
}
