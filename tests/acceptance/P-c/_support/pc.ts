// HUB-FR-119 · HUB-FR-126…130 · P-c1 · test-plan §2: helper int P-c (không chứa `it`). Dựng trên fixture P-b PF-S3 (Hub in-process
// THẬT + kho file local + Runtime giả `ScriptRuntime` + `resolver` cho `source.resolve`). Runtime giả của P-c: claim job stage,
// đặt token job (như Runtime khi claim), POST `/internal/jobs/:id/autofix-result`, rồi kết thúc job như cũ (plan §1 bước 7).
// Chưa có 0031 ⇒ `needPc` đỏ ở expect đầu ca; fixture KHÔNG chèn gì phụ thuộc 0031 (không đỏ ở `beforeAll`).
// jsonb qua `sql.json` (CONVENTIONS §2 bẫy).
import { expect } from "bun:test";
import { insertSource } from "../../P-b/pfs1/_local";
import {
  type Ctx3,
  type Job,
  type Json,
  jobDone,
  MD_AUTO,
  newJobToken,
  nextStageJob,
  P1,
  PA_FIX,
  type Role,
  resolver,
  runRow,
  type Sql,
  seedSources,
  settle,
  stageDef,
  start3,
  startRun,
  T,
  tokenHash,
  waitFor,
} from "../../P-b/pfs3/_local";

export {
  C1,
  type Ctx3,
  code,
  type Job,
  type Json,
  jobDone,
  MD_AUTO,
  nextStageJob,
  noStageJob,
  openTask,
  P1,
  PA,
  PA_FIX,
  type Role,
  review,
  runRow,
  type Sql,
  stageRow,
  sweep,
  T,
  URL_APP,
  waitFor,
  waitStatus,
} from "../../P-b/pfs3/_local";

export const LOCAL_PATH = "/qc-roots/pc-app";
export type CtxPc = Ctx3 & { pc: boolean };

export async function hasPcSchema(sql: Sql): Promise<boolean> {
  const [r] = await sql<
    { ok: boolean }[]
  >`select to_regclass('hub.autofix_results') is not null as ok`;
  return r?.ok === true;
}
/** Đầu mỗi ca int: chưa có migration 0031 ⇒ đỏ đúng lý do. */
export function needPc(c: CtxPc): void {
  expect({ migration0031: c.pc }).toEqual({ migration0031: true });
}

/** Hub + nguồn acme (`app-repo`, `other-repo`, `docs-lib` library, `local-app` local_path) + beta (`beta-repo`). */
export async function startPc(): Promise<CtxPc> {
  const c = await start3();
  const pc = c.ready && (await hasPcSchema(c.sql));
  if (c.ready) {
    await seedSources(c);
    await insertSource(c.sql, {
      tenant: T.acme,
      key: "local-app",
      kind: "local_path",
      config: { kind: "local_path", path: LOCAL_PATH },
    });
  }
  return Object.assign(c, { pc });
}

// ---------- def ----------
export type AfOpt = {
  source?: string;
  install?: string | null;
  test?: string;
  allow?: string[];
  after?: "review" | "auto";
  /** nguồn chỉ-đọc của stage (PB-R10) — để thử PC-R07. */
  read?: { source_key: string; allowlist: string[] }[];
  agent?: string;
  executor?: Json;
  key?: string;
};
export const afPart = (o: AfOpt = {}): Json => ({
  source_key: o.source ?? "app-repo",
  install_cmd: o.install ?? null,
  test_cmd: o.test ?? "bun test",
  write_allowlist: o.allow ?? [],
});
/** Stage tự-sửa (agent `hd-read`, review Kế toán) — `stageDef` P-a + `sources` + `autofix`. */
export function afStage(o: AfOpt = {}): Json {
  return {
    ...stageDef({
      key: o.key ?? "fix",
      name: "Sửa lỗi",
      executor: o.executor ?? { kind: "agent", agent_id: o.agent ?? P1.agRead },
      after: o.after === "auto" ? { kind: "auto" } : { kind: "review", group_id: PA_FIX.gKeToan },
      timeout_s: 1800,
      token_budget: null,
    }),
    sources: o.read ?? [],
    must_know: [],
    autofix: afPart(o),
  };
}
export function afDefBody(key: string, stages: Json[], sources: string[] = ["app-repo"]): Json {
  return {
    key,
    name: `Tự sửa ${key}`,
    description: "Quy trình tự-sửa của bộ test P-c.",
    input_hint: "Mô tả lỗi",
    run_group_ids: [],
    stages,
    token_budget: null,
    enabled: true,
    sources,
    inputs: [],
  };
}
/** `POST /process-defs` (Adm) — trả response thô (ca kiểm 201/422 tự xem). */
export const postDef = (c: CtxPc, body: Json, r: Role = "Adm") =>
  c.call(r, "POST", "/process-defs", body);
/** Def một stage tự-sửa; ≠ 201 ⇒ đỏ ở expect (chưa có contract/route). */
export async function mkAf(
  c: CtxPc,
  key: string,
  o: AfOpt = {},
  sources?: string[],
): Promise<string> {
  const r = await postDef(
    c,
    afDefBody(
      key,
      [afStage(o)],
      sources ?? [o.source ?? "app-repo", ...(o.read ?? []).map((s) => s.source_key)],
    ),
  );
  expect({ def: key, status: r.status, err: r.json?.error?.code }).toEqual({
    def: key,
    status: 201,
    err: undefined,
  });
  return r.json.id as string;
}

/** Def stage THƯỜNG có nguồn chỉ-đọc (P-b) — đối chứng "job không autofix". */
export async function mkPlain(c: CtxPc, key: string): Promise<string> {
  const st = {
    ...afStage({ read: [{ source_key: "app-repo", allowlist: ["src/**"] }] }),
    autofix: null,
  };
  const r = await postDef(c, afDefBody(key, [st]));
  expect({ def: key, status: r.status }).toEqual({ def: key, status: 201 });
  return r.json.id as string;
}

// ---------- chạy ----------
/** Bắt đầu run (A), resolver trả ok, chờ job stage 0; trả job + token job (đặt như Runtime khi claim). */
export async function startAf(c: CtxPc, key: string) {
  const rs = resolver(c);
  const s = await startRun(c, key);
  expect({ start: s.res.status }).toEqual({ start: 201 });
  const job = await nextStageJob(c, s.runId);
  const token = await jobToken(c.sql, job);
  return { runId: s.runId, job, token, rs };
}
/** Như `startAf` cho def thường. */
export const startPlain = (c: CtxPc, key: string) => startAf(c, key);
export async function jobToken(sql: Sql, job: Job): Promise<string> {
  const t = newJobToken();
  await sql`update hub.jobs set token_hash = ${tokenHash(t)} where id = ${job.id}`;
  return t;
}
export const afOf = (j: Job): Json => (j.payload as Json).autofix;

/** Báo cáo hợp lệ cho job (plan §3.3); `o` ghi đè. */
export function reportFor(j: Job, o: Json = {}): Json {
  const branch = afOf(j)?.branch ?? `ai/${j.payload.run_id}/fix`;
  return {
    status: "ok",
    branch,
    base_sha: "1".repeat(40),
    head_sha: "2".repeat(40),
    diff: DIFF,
    diff_stats: { files: 1, insertions: 1, deletions: 1, bytes: DIFF.length },
    test: { exit_code: 0, duration_ms: 12_400, log_tail: "12 pass\n0 fail" },
    failures: [],
    commands: [{ tool: "exec", arg: "bun test", exit_code: 0, ms: 900 }],
    ...o,
  };
}
export const DIFF =
  "diff --git a/src/tong.ts b/src/tong.ts\n--- a/src/tong.ts\n+++ b/src/tong.ts\n@@ -1,3 +1,3 @@\n export function tong(a: number, b: number) {\n-  return a - b;\n+  return a + b;\n }\n";
export const failedReport = (j: Job, failures: Json[], test: Json = null): Json =>
  reportFor(j, { status: "check_failed", diff: null, diff_stats: null, test, failures });

export async function postReport(
  c: { base: string },
  jobId: string,
  token: string | null,
  body: unknown,
  raw?: string,
): Promise<{ status: number; json: Json; text: string; headers: Headers }> {
  const res = await fetch(`${c.base}/internal/jobs/${jobId}/autofix-result`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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
/** Báo cáo 201 rồi kết thúc job (md hợp template) — như Runtime (plan §1 bước 7). */
export async function reportAndDone(c: CtxPc, job: Job, token: string, body: Json): Promise<void> {
  const r = await postReport(c, job.id, token, body);
  expect({ report: r.status, err: r.json?.error?.code }).toEqual({ report: 201, err: undefined });
  await jobDone(c, job, MD_AUTO);
}

// ---------- đọc ----------
export const afRows = (sql: Sql, runId: string) =>
  sql<
    Json[]
  >`select * from hub.autofix_results where process_run_id = ${runId} order by created_at, id`;
export const attRow = async (sql: Sql, id: string | null): Promise<Json | undefined> =>
  id ? (await sql<Json[]>`select * from hub.attachments where id = ${id}`)[0] : undefined;
export async function waitDecision(sql: Sql, runId: string, ms = 8_000): Promise<Json> {
  const r = await waitFor(
    () => runRow(sql, runId),
    (v) => v?.status === "needs_decision",
    ms,
  );
  expect({ status: r?.status }).toEqual({ status: "needs_decision" });
  return r?.decision;
}
export const viewOf = (c: CtxPc, who: Role, runId: string) =>
  c.call(who, "GET", `/process-runs/${runId}`);
export const stageView = async (c: CtxPc, who: Role, runId: string, idx = 0): Promise<Json> =>
  ((await viewOf(c, who, runId)).json?.stages ?? [])[idx];
export const content = (c: CtxPc, who: Role, id: string) =>
  c.call(who, "GET", `/attachments/${id}/content`);
export async function internalGet(
  c: { base: string },
  jobId: string,
  token: string,
  attId: string,
) {
  const res = await fetch(`${c.base}/internal/jobs/${jobId}/attachments/${attId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: res.status, text: await res.text() };
}

/** Dọn giữa ca (P-b settle) + xoá kết quả P-c (owner, khi bảng có). */
export async function settlePc(c: CtxPc): Promise<void> {
  await settle(c);
  if (c.pc) await c.sql`delete from hub.autofix_results`;
}
export { settle };
