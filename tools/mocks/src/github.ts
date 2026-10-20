// HUB-FR-129 · HUB-BR-34 · P-c2 (spec §7, plan §6.5): mock GitHub REST + GraphQL cho Hub mở PR / bật auto-merge. Chỉ test/UAT.
// Dữ liệu trong bộ nhớ. Endpoint thật: `GET/POST /repos/:o/:r/pulls`, `POST /graphql` (enablePullRequestAutoMerge).
// Điều khiển (không auth): `/__mock/reset|queue|pulls|calls` — hoặc gọi thẳng `mock.*` khi chạy trong cùng tiến trình.
import { type Context, Hono } from "hono";
import { isPlainObject } from "./scenario";

export const GH_OPS = ["pulls.list", "pulls.create", "graphql"] as const;
export type GhOp = (typeof GH_OPS)[number];
/** Phản hồi ép (lấy theo thứ tự cho `op`): `raw` thay thân JSON (vd thân > 1 MiB). */
export type GhForced = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  raw?: string;
};
export type GhPr = {
  number: number;
  node_id: string;
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  state: "open" | "closed";
  html_url: string;
  auto_merge: { merge_method: string } | null;
};
export type GhCall = {
  op: GhOp | "other";
  method: string;
  path: string;
  query: Record<string, string>;
  auth: string | null;
  headers: Record<string, string>;
  body: unknown;
};
export type GithubMockOpts = { tokens?: string[]; webHost?: string };

export const GH_MOCK_TOKEN = "ghp-mock-ok";
const DOCS = "https://docs.github.com/rest";
export const GH_BAD_CREDENTIALS = { message: "Bad credentials", documentation_url: DOCS };
export const GH_NOT_FOUND = { message: "Not Found", documentation_url: DOCS };
export const ghAlreadyExists = (owner: string, head: string) => ({
  message: "Validation Failed",
  errors: [
    {
      resource: "PullRequest",
      code: "custom",
      message: `A pull request already exists for ${owner}:${head}.`,
    },
  ],
  documentation_url: DOCS,
});

const opOf = (method: string, path: string): GhOp | "other" => {
  if (/^\/repos\/[^/]+\/[^/]+\/pulls$/.test(path))
    return method === "GET" ? "pulls.list" : "pulls.create";
  if (path === "/graphql" && method === "POST") return "graphql";
  return "other";
};
const tokenOf = (auth: string | null): string | null =>
  /^(?:bearer|token) (.+)$/i.exec(auth ?? "")?.[1]?.trim() ?? null;

type GhState = {
  tokens: string[];
  webHost: string;
  prs: GhPr[];
  log: GhCall[];
  queue: Map<GhOp, GhForced[]>;
  seq: number;
};
type SeedPr = {
  owner: string;
  repo: string;
  head: string;
  base: string;
  state?: "open" | "closed";
};

const view = (p: GhPr) => ({
  number: p.number,
  node_id: p.node_id,
  state: p.state,
  title: p.title,
  body: p.body,
  html_url: p.html_url,
  head: { ref: p.head, label: `${p.owner}:${p.head}` },
  base: { ref: p.base },
  auto_merge: p.auto_merge,
});
const forced = (f: GhForced): Response =>
  new Response(f.raw ?? (f.body === undefined ? "" : JSON.stringify(f.body)), {
    status: f.status,
    headers: { "content-type": "application/json", ...(f.headers ?? {}) },
  });
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-ratelimit-remaining": "4999" },
  });
const headOf = (owner: string, h: string) => (h.includes(":") ? h : `${owner}:${h}`);

function seedPr(s: GhState, o: SeedPr): GhPr {
  s.seq += 1;
  const seq = s.seq;
  const pr: GhPr = {
    number: seq,
    node_id: `PR_mock_${seq}`,
    owner: o.owner,
    repo: o.repo,
    head: o.head,
    base: o.base,
    title: `seed ${seq}`,
    body: "",
    state: o.state ?? "open",
    html_url: `https://${s.webHost}/${o.owner}/${o.repo}/pull/${seq}`,
    auto_merge: null,
  };
  s.prs.push(pr);
  return pr;
}

function mockApi(s: GhState, opts: GithubMockOpts) {
  return {
    reset(o: GithubMockOpts = {}): void {
      s.tokens = o.tokens ?? opts.tokens ?? [GH_MOCK_TOKEN];
      s.webHost = o.webHost ?? opts.webHost ?? "github.com";
      s.prs = [];
      s.log = [];
      s.queue = new Map();
      s.seq = 0;
    },
    queue(op: GhOp, ...responses: GhForced[]): void {
      s.queue.set(op, [...(s.queue.get(op) ?? []), ...responses]);
    },
    seedPr: (o: SeedPr): GhPr => seedPr(s, o),
    calls: (op?: GhOp): GhCall[] => s.log.filter((c) => op === undefined || c.op === op),
    pulls: (): GhPr[] => s.prs.map((p) => ({ ...p })),
  };
}

function controlRoutes(app: Hono, mock: ReturnType<typeof mockApi>): void {
  app.post("/__mock/reset", async (c) => {
    const b = await c.req.json().catch(() => ({}));
    mock.reset(isPlainObject(b) ? (b as GithubMockOpts) : {});
    return c.body(null, 204);
  });
  app.post("/__mock/queue", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { op?: GhOp; responses?: GhForced[] };
    if (!b.op || !GH_OPS.includes(b.op) || !Array.isArray(b.responses))
      return c.json(GH_NOT_FOUND, 400);
    mock.queue(b.op, ...b.responses);
    return c.body(null, 204);
  });
  app.post("/__mock/pulls", async (c) => c.json(mock.seedPr(await c.req.json()), 201));
  app.get("/__mock/pulls", (c) => c.json({ pulls: mock.pulls() }));
  app.get("/__mock/calls", (c) => c.json({ calls: mock.calls() }));
}

async function record(
  s: GhState,
  c: Context,
): Promise<{ op: GhOp | "other"; url: URL; body: unknown }> {
  const url = new URL(c.req.url);
  const op = opOf(c.req.method, url.pathname);
  const body: unknown = c.req.method === "GET" ? null : await c.req.json().catch(() => null);
  s.log.push({
    op,
    method: c.req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    auth: c.req.header("authorization") ?? null,
    headers: Object.fromEntries(c.req.raw.headers),
    body,
  });
  return { op, url, body };
}

function listPulls(s: GhState, owner: string, repo: string, q: URLSearchParams): Response {
  const head = q.get("head") ?? "";
  const state = q.get("state") ?? "open";
  const hit = s.prs.filter(
    (p) =>
      p.owner === owner &&
      p.repo === repo &&
      (!head || `${p.owner}:${p.head}` === head) &&
      (state === "all" || p.state === state),
  );
  return json(hit.slice(0, Number(q.get("per_page") ?? 30)).map(view));
}

function createPull(s: GhState, owner: string, repo: string, body: unknown): Response {
  const b = isPlainObject(body) ? body : {};
  const missing = ["title", "head", "base"].find((k) => typeof b[k] !== "string" || b[k] === "");
  if (missing)
    return json(
      {
        message: "Validation Failed",
        errors: [{ resource: "PullRequest", field: missing, code: "missing_field" }],
      },
      422,
    );
  const head = String(b.head);
  const full = headOf(owner, head);
  const dup = s.prs.find(
    (p) =>
      p.owner === owner && p.repo === repo && p.state === "open" && `${p.owner}:${p.head}` === full,
  );
  if (dup) return json(ghAlreadyExists(owner, dup.head), 422);
  const pr = seedPr(s, { owner, repo, head: full.split(":")[1] ?? head, base: String(b.base) });
  pr.title = String(b.title);
  pr.body = typeof b.body === "string" ? b.body : "";
  return json(view(pr), 201);
}

function graphql(s: GhState, body: unknown): Response {
  const b = isPlainObject(body) ? body : {};
  const q = typeof b.query === "string" ? b.query : "";
  const vars = isPlainObject(b.variables) ? b.variables : {};
  if (!q.includes("enablePullRequestAutoMerge"))
    return json({
      errors: [{ type: "NOT_SUPPORTED", message: "mock: chỉ enablePullRequestAutoMerge" }],
    });
  const text = `${q} ${JSON.stringify(vars)}`;
  const pr = s.prs.find((p) => text.includes(p.node_id));
  if (!pr)
    return json({
      data: null,
      errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node" }],
    });
  const method = /SQUASH|MERGE|REBASE/.exec(text)?.[0] ?? "MERGE";
  pr.auto_merge = { merge_method: method.toLowerCase() };
  return json({
    data: {
      enablePullRequestAutoMerge: {
        pullRequest: { number: pr.number, autoMergeRequest: { mergeMethod: method } },
      },
    },
  });
}

export function createGithubMock(opts: GithubMockOpts = {}) {
  const s: GhState = {
    tokens: opts.tokens ?? [GH_MOCK_TOKEN],
    webHost: opts.webHost ?? "github.com",
    prs: [],
    log: [],
    queue: new Map(),
    seq: 0,
  };
  const mock = mockApi(s, opts);
  const app = new Hono();
  controlRoutes(app, mock);
  app.all("*", async (c) => {
    const { op, url, body } = await record(s, c);
    if (op === "other") return json(GH_NOT_FOUND, 404);
    const f = s.queue.get(op)?.shift();
    if (f) return forced(f);
    const t = tokenOf(c.req.header("authorization") ?? null);
    if (!t || !s.tokens.includes(t)) return json(GH_BAD_CREDENTIALS, 401);
    if (op === "graphql") return graphql(s, body);
    const [, , owner = "", repo = ""] = url.pathname.split("/");
    if (op === "pulls.list") return listPulls(s, owner, repo, url.searchParams);
    return createPull(s, owner, repo, body);
  });
  return { app, fetch: app.fetch, mock };
}
export type GithubMock = ReturnType<typeof createGithubMock>;
