// HUB-FR-129 · HUB-FR-128 · HUB-FR-130 · HUB-FR-68 · HUB-BR-30 · HUB-BR-34 · P-c2 · test-plan P-c2 §2: helper int (không chứa `it`).
// Hub in-process THẬT (như P-b PF-S3 `start3`) + seam `hubSecretsKey` (H4b-1) + seam GitHub (`github.apiUrl/webHost` + env
// `HUB_GITHUB_API_URL`/`HUB_GITHUB_WEB_HOST`, test-plan §6 G1) trỏ vào mock GitHub `tools/mocks/src/github.ts` (cùng tiến trình).
// Runtime GIẢ cho job `source.apply`: claim (queued→running + token job) → (khoá) `POST …/source-credential` → `POST …/apply-result`
// → kết thúc job bằng UPDATE `hub.jobs` (như `finish_resolve` của Runtime — G2). Chưa có 0032 ⇒ `needPc2` đỏ ở expect đầu ca;
// fixture KHÔNG chèn gì phụ thuộc 0032 (nguồn có khoá chèn SQL jsonb — được trước code). jsonb qua `sql.json`.
import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../../apps/hub-api/src/lib/redis";
import type { AttachmentStorage } from "../../../../apps/hub-api/src/modules/attachments/storage";
import { createLocalStorage } from "../../../../apps/hub-api/src/modules/attachments/storage.local";
import { createGithubMock, type GithubMock } from "../../../../tools/mocks/src/github";
import { HUB_API_URL, type HubDeps, makeKeys, REDIS_TEST_URL, sign } from "../../H1/_fixtures";
import { testRedis } from "../../H1/_hub";
import { ScriptRuntime } from "../../H1/_runtime";
import { HUB_KEY, seedSecret, tableExists } from "../../H4b1/_h4b1";
import { api, setupPa } from "../../P-a/_support/pa";
import { seedPf1 } from "../../P-a/pf1/_local";
import { insertSource } from "../../P-b/pfs1/_local";
import {
  newJobToken,
  resolver,
  seedSources,
  stageDef,
  startRun,
  stopAllResolvers,
  tokenHash,
} from "../../P-b/pfs3/_local";
import {
  afStage,
  type CtxPc,
  type Json,
  jobDone,
  jobToken,
  LOCAL_PATH,
  MD_AUTO,
  nextStageJob,
  openTask,
  PA,
  postDef,
  postReport,
  type Role,
  reportFor,
  review,
  runRow,
  type Sql,
  settle,
  sweep,
  T,
} from "../../P-c/_support/pc";

export { newJobToken, resolver, startRun, tokenHash } from "../../P-b/pfs3/_local";
export * from "../../P-c/_support/pc";

// ---------- id + giá trị cố định (dải `c2c1…`) ----------
export const Y = (n: number) => `c2c10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Secret theo spec H4b-1 (chèn owner, bản mã đối chứng KEY_BYTES = `HUB_KEY`). */
export const SEC = {
  acme: Y(101),
  acme2: Y(102),
  beta: Y(103),
  khAcme: Y(104),
  provider: Y(105),
  missing: Y(199),
} as const;
/** Giá trị token (≥ 8 ký tự, dễ nhận khi rò). */
export const TOK = {
  acme: "qc-pc2-tok-acme-Zx9Pq7Lm",
  acme2: "qc-pc2-tok-acme2-Zx9Pq7Lm",
  beta: "qc-pc2-tok-beta-Zx9Pq7Lm",
  kh: "qc-pc2-tok-kh-Zx9Pq7Lm",
  provider: "qc-pc2-tok-prov-Zx9Pq7Lm",
} as const;
export const ALL_TOKENS: readonly string[] = Object.values(TOK);
export const OWNER = "pc2-test";
export const ghUrl = (repo: string) => `https://github.com/${OWNER}/${repo}.git`;
export const GL_URL = "https://gitlab.com/pc2-test/gl-repo.git";
/** Nguồn P-c2 (acme trừ `beta-priv`): khoá + chế độ áp. */
export const SRC2 = {
  priv: { key: "gh-priv", url: ghUrl("app-repo"), cred: SEC.acme, mode: undefined },
  auto: { key: "gh-auto", url: ghUrl("auto-repo"), cred: SEC.acme, mode: "auto_merge" },
  branch: { key: "gh-branch", url: ghUrl("branch-repo"), cred: SEC.acme, mode: "branch_only" },
  pub: { key: "gh-pub", url: ghUrl("pub-repo"), cred: null, mode: undefined },
  gl: { key: "gl-repo", url: GL_URL, cred: null, mode: undefined },
  betaPriv: { key: "beta-priv", url: ghUrl("beta-repo"), cred: SEC.beta, mode: undefined },
} as const;
export type Src2 = keyof typeof SRC2;
export const HEAD = "c3d4e5f60718293a4b5c6d7e8f90123456789012";
export const TARGET2 = "d4e5f60718293a4b5c6d7e8f9012345678901234";
export const SECRET = "AKIAQCQCQCQCQCQCQCQC";
/** Output stage tự-sửa có `## Thay đổi`/`## Test` (PC2-R14) + mục khác không được vào PR. */
export const MD_FIX = `${MD_AUTO}\n\n## Thay đổi\nSửa dấu cộng ở src/tong.ts. Khoá cũ ${SECRET}\n\n## Test\n12 pass · 0 fail\n\n## Ghi chú riêng\nKHÔNG-VÀO-PR\n`;
export const INPUT = "QC-INPUT-PC2 đầu vào người dùng";

export type CtxPc2 = CtxPc & {
  pc2: boolean;
  gh: GithubMock["mock"];
  ghBase: string;
  src: Record<Src2 | "local", string>;
};

export async function hasPc2Schema(sql: Sql): Promise<boolean> {
  const [r] = await sql<
    { ok: boolean }[]
  >`select to_regclass('hub.autofix_applies') is not null as ok`;
  return r?.ok === true;
}
/** Đầu mỗi ca int: chưa có migration 0032 ⇒ đỏ đúng lý do. */
export function needPc2(c: CtxPc2): void {
  expect({ migration0032: c.pc2 }).toEqual({ migration0032: true });
}

async function seedSecrets(sql: Sql): Promise<void> {
  if (!(await tableExists(sql))) return;
  const s = (id: string, kind: string, tenantId: string | null, name: string, value: string) =>
    seedSecret(sql, { id, kind, tenantId, name, value });
  await s(SEC.acme, "source_credential", T.acme, "gh-acme-pat", TOK.acme);
  await s(SEC.acme2, "source_credential", T.acme, "gh-acme-pat-2", TOK.acme2);
  await s(SEC.beta, "source_credential", T.beta, "gh-beta-pat", TOK.beta);
  await s(SEC.khAcme, "kh_api_key", T.acme, "kh-acme", TOK.kh);
  await s(SEC.provider, "provider_api_key", null, "prov-pc2", TOK.provider);
}

async function seedSources2(c: CtxPc2): Promise<void> {
  for (const [name, s] of Object.entries(SRC2) as [Src2, (typeof SRC2)[Src2]][]) {
    const config: Json = {
      kind: "git_remote",
      url: s.url,
      branch: "main",
      credential_secret_id: s.cred,
    };
    if (s.mode) config.apply_mode = s.mode;
    c.src[name] = await insertSource(c.sql, {
      tenant: name === "betaPriv" ? T.beta : T.acme,
      key: s.key,
      kind: "git_remote",
      config,
    });
  }
  c.src.local = await insertSource(c.sql, {
    tenant: T.acme,
    key: "local-app",
    kind: "local_path",
    config: { kind: "local_path", path: LOCAL_PATH },
  });
}

// ---------- dựng Hub ----------
export async function startPc2(
  o: { webHost?: string; storage?: AttachmentStorage } = {},
): Promise<CtxPc2> {
  const { sql, ready } = await setupPa();
  if (ready) await seedPf1(sql);
  await seedSecrets(sql);
  const gh = createGithubMock({ tokens: [TOK.acme, TOK.beta] });
  const ghServer = Bun.serve({ port: 0, fetch: gh.fetch, idleTimeout: 0 });
  const ghBase = `http://localhost:${ghServer.port}`;
  const webHost = o.webHost ?? "github.com";
  process.env.HUB_GITHUB_API_URL = ghBase;
  process.env.HUB_GITHUB_WEB_HOST = webHost;
  const k = await makeKeys();
  const dir = await mkdtemp(join(tmpdir(), "pc2-"));
  const storage = o.storage ?? (await createLocalStorage({ dir })); // FB1: o.storage = driver FileBox
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const clock = { off: 0 };
  let handles: Json | null = null;
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId: "qc-pc2-1",
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 4,
    processEngine: true,
    processLoops: false,
    now: () => new Date(Date.now() + clock.off),
    onProcessHandles: (h: Json) => {
      handles = h;
    },
    sourceCheckTimeoutMs: 1500,
    hubSecretsKey: HUB_KEY,
    github: { apiUrl: ghBase, webHost },
    attachments: { storage, tenantMaxBytes: 1_073_741_824, sweepS: 600, sweep: false },
  } as unknown as HubDeps & Record<string, unknown>;
  const app = createApp(
    {
      version: "0.0.0-test",
      corsOrigins: ["http://localhost:3100"],
      sourceCheckTimeoutMs: 1500,
    } as never,
    deps,
  );
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  const rtRedis = await testRedis();
  const base = `http://localhost:${server.port}`;
  const hub = {
    base,
    db,
    redis,
    instanceId: "qc-pc2-1",
    handles: () => handles,
    kicks: [],
  } as never;
  const tok = (r: Role) => sign(k, PA[r]);
  const c: CtxPc2 = {
    sql,
    ready,
    k,
    hub,
    redis: rtRedis,
    rt: new ScriptRuntime(sql, rtRedis),
    tok,
    call: async (r, method, path, body) => api(hub, await tok(r), method, path, body),
    base,
    dir,
    clock,
    ids: { app: "", other: "", lib: "", libDoc: "", beta: "" },
    pc: true,
    pc2: ready && (await hasPc2Schema(sql)),
    gh: gh.mock,
    ghBase,
    src: {} as CtxPc2["src"],
    stop: async () => {
      await stopAllResolvers();
      ac.abort();
      await server.stop(true);
      await ghServer.stop(true);
      redis.disconnect();
      rtRedis.disconnect();
      await db.close();
      await sql.end();
      await rm(dir, { recursive: true, force: true });
    },
  };
  if (ready) {
    await seedSources(c);
    await seedSources2(c);
  }
  return c;
}

// ---------- def ----------
/** Stage Áp (plan §6.7): executor apply, real_action, auto, không nguồn/tự-sửa/ngân sách/must_know. */
export function applyStage(o: Json = {}): Json {
  return {
    ...stageDef({
      key: o.key ?? "apply",
      name: o.name ?? "Áp bản sửa (PR)",
      executor: { kind: "apply" },
      instruction: "Áp bản sửa đã duyệt.",
      output: {
        filename: "apply.md",
        template: "## Kết quả áp\n",
        required_sections: ["Kết quả áp"],
        fields: [],
      },
      after: { kind: "auto" },
      real_action: o.real_action ?? true,
      timeout_s: 600,
      token_budget: null,
    }),
    sources: [],
    must_know: [],
    autofix: null,
    ...o,
  };
}
export function applyDefBody(key: string, source: string, stages?: Json[]): Json {
  return {
    key,
    name: `Áp ${key}`,
    description: "Quy trình tự sửa + áp của bộ test P-c2.",
    input_hint: "Mô tả lỗi",
    run_group_ids: [],
    stages: stages ?? [
      afStage({ source, install: "bun install", allow: ["src/**"] }),
      applyStage(),
    ],
    token_budget: null,
    enabled: true,
    sources: [source],
    inputs: [],
  };
}
/** Def tự-sửa + Áp; ≠ 201 ⇒ đỏ ở expect. */
export async function mkApply(
  c: CtxPc2,
  key: string,
  source: string,
  r: Role = "Adm",
): Promise<string> {
  const res = await postDef(c, applyDefBody(key, source), r);
  expect({ def: key, status: res.status, err: res.json?.error?.code }).toEqual({
    def: key,
    status: 201,
    err: undefined,
  });
  return res.json.id as string;
}

// ---------- chạy tới gate + Áp ----------
export type Gate = { runId: string; fixJob: Json; token: string; taskId: string };
/** Bắt đầu run (A, input riêng), resolver ok, job tự-sửa báo `ok` (hoặc `fix`), output MD_FIX ⇒ waiting_review. */
export async function toGate(
  c: CtxPc2,
  key: string,
  o: { report?: Json; role?: Role } = {},
): Promise<Gate> {
  resolver(c);
  const s = await startRun(c, key, { input: INPUT, role: o.role });
  expect({ start: s.res.status, err: s.res.json?.error?.code }).toEqual({
    start: 201,
    err: undefined,
  });
  const job = await nextStageJob(c, s.runId);
  const token = await jobToken(c.sql, job);
  const r = await postReport(c, job.id, token, reportFor(job, o.report ?? {}));
  expect({ report: r.status, err: r.json?.error?.code }).toEqual({ report: 201, err: undefined });
  await jobDone(c, job, MD_FIX);
  await waitRunIn(c, s.runId, ["waiting_review"]);
  const t = await openTask(c.sql, s.runId, "review");
  return { runId: s.runId, fixJob: job, token, taskId: t?.id };
}
/** B (Kế toán) Đạt gate stage tự-sửa. */
export async function passGate(c: CtxPc2, g: Gate): Promise<void> {
  const r = await review(c, "B", g.taskId, { result: "pass" });
  expect({ pass: r.status }).toEqual({ pass: 200 });
}

export type ApplyJob = { id: string; tenant_id: string; payload: Json; token: string };
export const applyJobs = (sql: Sql, runId: string) =>
  sql<Json[]>`select id, tenant_id, status, payload, error_reason from hub.jobs
    where type = 'source.apply' and payload->>'process_run_id' = ${runId} order by created_at, id`;
/** Như Runtime: chờ job `source.apply` `queued` của run → running + token job. */
export async function claimApply(c: CtxPc2, runId: string, ms = 10_000): Promise<ApplyJob> {
  const end = Date.now() + ms;
  for (;;) {
    const j = (await applyJobs(c.sql, runId)).find((x) => x.status === "queued");
    if (j) {
      const token = newJobToken();
      const u = await c.sql`update hub.jobs set status = 'running', worker_id = 'qc-rt-apply',
        started_at = now(), heartbeat_at = now(), token_hash = ${tokenHash(token)}
        where id = ${j.id} and status = 'queued' returning id`;
      if (u.length === 1) return { id: j.id, tenant_id: j.tenant_id, payload: j.payload, token };
    }
    if (Date.now() > end) break;
    await Bun.sleep(50);
  }
  expect({ applyJobQueued: false }).toEqual({ applyJobQueued: true });
  throw new Error("unreachable");
}
/** gate Đạt ⇒ job Áp đã claim. */
export async function toApply(c: CtxPc2, key: string, o: { report?: Json } = {}) {
  const g = await toGate(c, key, o);
  await passGate(c, g);
  const aj = await claimApply(c, g.runId);
  return { ...g, aj };
}

export type Http = { status: number; json: Json; text: string; headers: Headers };
async function post(
  c: { base: string },
  path: string,
  token: string | null,
  body: unknown,
  raw?: string,
): Promise<Http> {
  const res = await fetch(`${c.base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
    },
    body: raw ?? JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
export const postApply = (
  c: { base: string },
  jobId: string,
  token: string | null,
  body: unknown,
  raw?: string,
) => post(c, `/internal/jobs/${jobId}/apply-result`, token, body, raw);
export const postCred = (c: { base: string }, jobId: string, token: string | null, body: unknown) =>
  post(c, `/internal/jobs/${jobId}/source-credential`, token, body);

/** `ApplyReport` (plan §3.5) — mặc định `pushed` lên C1 (không rebase). */
export function applyBody(o: Json = {}): Json {
  return {
    status: "pushed",
    target_sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    head_sha: HEAD,
    rebased: false,
    code: null,
    conflict_files: [],
    failures: [],
    test: null,
    ...o,
  };
}
/** Kết thúc job Áp như Runtime (`finish_resolve`): UPDATE status/lý do (G2). */
export async function endApply(
  c: CtxPc2,
  j: ApplyJob,
  o: { status?: "succeeded" | "failed"; reason?: string | null; code?: string | null } = {},
): Promise<void> {
  const status = o.status ?? "succeeded";
  await c.sql`update hub.jobs set status = ${status}, error_code = ${o.code ?? (status === "failed" ? "INTERNAL_ERROR" : null)},
    error_reason = ${o.reason ?? null}, error_message = ${status === "failed" ? "lỗi thử" : null}, finished_at = now()
    where id = ${j.id} and status = 'running'`;
}
/** Báo cáo 201 rồi kết thúc job (plan §1 bước 6). */
export async function reportApply(c: CtxPc2, j: ApplyJob, o: Json = {}): Promise<void> {
  const r = await postApply(c, j.id, j.token, applyBody(o));
  expect({ applyResult: r.status, err: r.json?.error?.code }).toEqual({
    applyResult: 201,
    err: undefined,
  });
  await endApply(c, j);
}
/** Chờ run vào một trong `statuses` (gọi `sweepOnce` định kỳ — vòng nền tắt trong test, G2). */
export async function waitRunIn(
  c: CtxPc2,
  runId: string,
  statuses: string[],
  ms = 12_000,
): Promise<Json> {
  const end = Date.now() + ms;
  let last: Json;
  let n = 0;
  for (;;) {
    last = await runRow(c.sql, runId);
    if (statuses.includes(last?.status)) return last;
    if (Date.now() > end) break;
    if (++n % 8 === 0) await sweep(c).catch(() => undefined);
    await Bun.sleep(50);
  }
  expect({ run: last?.status }).toEqual({ run: statuses.join("|") });
  return last;
}

// ---------- đọc ----------
export const applyRows = (sql: Sql, runId: string) =>
  sql<
    Json[]
  >`select * from hub.autofix_applies where process_run_id = ${runId} order by created_at, id`;
export async function oneApply(sql: Sql, runId: string): Promise<Json> {
  const rows = await applyRows(sql, runId);
  expect({ applyRows: rows.length }).toEqual({ applyRows: 1 });
  return rows[0];
}
export const decisionOf = async (sql: Sql, runId: string): Promise<Json> =>
  (await runRow(sql, runId))?.decision;
/** Mọi giá trị khoá KHÔNG có trong `text`. */
export function expectNoToken(where: string, text: string): void {
  expect({ where, leaked: ALL_TOKENS.filter((t) => text.includes(t)) }).toEqual({
    where,
    leaked: [],
  });
}
/** Dọn giữa ca (P-b settle) + xoá kết quả P-c/P-c2 (owner) + reset mock GitHub. */
export async function settlePc2(c: CtxPc2): Promise<void> {
  await settle(c);
  c.gh.reset({ tokens: [TOK.acme, TOK.beta] });
  if (c.pc2) await c.sql`delete from hub.autofix_applies`;
  const [r] = await c.sql<
    { ok: boolean }[]
  >`select to_regclass('hub.autofix_results') is not null as ok`;
  if (r?.ok) await c.sql`delete from hub.autofix_results`;
}
