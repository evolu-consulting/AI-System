// P-b · PF-S3 · HUB-FR-122/123/124/125 · PB-R05/R09…R14 · C2/C12/C16…C20/C23 · helper riêng thư mục pfs3 (không chứa `it(...)`).
// Hub in-process: launcher THẬT + kho file local + seam `now` (đồng hồ chỉnh được) + `onProcessHandles` (sweepOnce). Runtime GIẢ:
// `ScriptRuntime` (job `agent.cli` của run quy trình) + `resolver` (job `source.resolve`: claim + POST `/sources-resolved` bằng job-token).
// Mọi request đi qua HTTP (JSON thô), KHÔNG import symbol chưa tồn tại ⇒ biên dịch được trước code S3.
// Mọi jsonb qua `sql.json`, mảng uuid qua `sql.array(…, 2950)` (CONVENTIONS §2 bẫy).
import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_STREAM_FIELD, runStreamKey } from "@ai/contracts/hub";
import { createApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../../apps/hub-api/src/lib/redis";
import { createLocalStorage } from "../../../../apps/hub-api/src/modules/attachments/storage.local";
import { HUB_API_URL, type HubDeps, makeKeys, REDIS_TEST_URL, sign } from "../../H1/_fixtures";
import { testRedis } from "../../H1/_hub";
import { type Job, ScriptRuntime } from "../../H1/_runtime";
import { newJobToken, tokenHash } from "../../H2a/_runtime2";
import {
  AGB,
  api,
  type CtxPa,
  defInput,
  type Json,
  PA,
  PA_FIX,
  type Role,
  type Sql,
  setupPa,
  stageDef,
  T,
  waitFor,
} from "../../P-a/_support/pa";
import {
  jobAsk,
  jobDone,
  MD_AUTO,
  nextStageJob,
  noStageJob,
  openTask,
  outputs,
  P1,
  review,
  runRow,
  seedPf1,
  stageRow,
  usage,
  waitStatus,
} from "../../P-a/pf1/_local";
import { gitBody, libBody, seedLibraryDoc } from "../pfs1/_local";

export {
  type Job,
  type Json,
  jobAsk,
  jobDone,
  MD_AUTO,
  newJobToken,
  nextStageJob,
  noStageJob,
  openTask,
  outputs,
  P1,
  PA,
  PA_FIX,
  type Role,
  review,
  runRow,
  type Sql,
  stageDef,
  stageRow,
  T,
  tokenHash,
  usage,
  waitFor,
  waitStatus,
};

export const X = (n: number) => `b3b30000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const C1 = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
export const C2 = "b2c3d4e5f60718293a4b5c6d7e8f901234567890";
export const URL_APP = "https://github.com/pb-test/app-repo.git";
export const URL_OTHER = "https://github.com/pb-test/other-repo.git";
export const DESC_APP = "Mã nguồn ứng dụng kế toán";
export const LIB_VERSION = X(801);
export const AG_TOOLS = X(11);

export type Ctx3 = CtxPa & {
  base: string;
  dir: string;
  /** Đồng hồ Hub (seam `now`): `off` ms cộng vào giờ thật. */
  clock: { off: number };
  ids: { app: string; other: string; lib: string; libDoc: string; beta: string };
};

// ---------- dựng Hub ----------
export async function start3(): Promise<Ctx3> {
  const { sql, ready } = await setupPa();
  if (ready) {
    await seedPf1(sql);
    await seedAgentTools(sql);
  }
  const k = await makeKeys();
  const dir = await mkdtemp(join(tmpdir(), "pb-pfs3-"));
  const storage = await createLocalStorage({ dir });
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
    instanceId: "qc-pfs3-1",
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
    instanceId: "qc-pfs3-1",
    handles: () => handles,
    kicks: [],
  } as never;
  const tok = (r: Role) => sign(k, PA[r]);
  const c: Ctx3 = {
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
    stop: async () => {
      stopAllResolvers();
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      rtRedis.disconnect();
      await db.close();
      await sql.end();
      await rm(dir, { recursive: true, force: true });
    },
  };
  return c;
}

/** Agent `hd-tools` có `allowed_tools=[Read,Write,Bash,WebFetch]` (ST-06) — agent cấu hình rộng hơn R/G/G. */
async function seedAgentTools(sql: Sql): Promise<void> {
  const [p] = await sql<
    { profile_id: string }[]
  >`select profile_id from hub.agents where id = ${AGB.hoadon}`;
  await sql`insert into hub.agents (id, key, name, description, runtime, profile_id, system_prompt, runtime_options)
    values (${AG_TOOLS}, 'hd-tools', ${sql.json({ vi: "Đọc đủ quyền", en: "Full tools" })},
      'Agent thử cho P-b: cấu hình công cụ rộng.', 'agentic-cli', ${p?.profile_id ?? null}, '',
      ${sql.json({ allowed_tools: ["Read", "Write", "Bash", "WebFetch"] })})`;
  await sql`insert into hub.agent_entitlements (agent_id, tenant_id) values (${AG_TOOLS}, ${T.acme})`;
  await sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
    values (${AG_TOOLS}, ${T.acme}, 'user', ${PA.A.id})`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

// ---------- nguồn + quy trình qua API ----------
/** Nguồn acme `app-repo`, `other-repo`, `docs-lib` (library `quy-dinh.md`), nguồn beta `beta-repo`. Trả id vào `c.ids`. */
export async function seedSources(c: Ctx3): Promise<void> {
  const mk = async (role: Role, body: Json): Promise<string> => {
    const r = await c.call(role, "POST", "/admin/sources", body);
    if (r.status !== 201)
      throw new Error(
        `FIXTURE SAI POST /admin/sources ${body.key}: ${r.status} ${JSON.stringify(r.json)}`,
      );
    return r.json.id as string;
  };
  c.ids.app = await mk("Adm", gitBody("app-repo", { url: URL_APP, description: DESC_APP }));
  c.ids.other = await mk("Adm", gitBody("other-repo", { url: URL_OTHER, description: "Repo phụ" }));
  const doc = await seedLibraryDoc(c.sql, {
    tenant: T.acme,
    userId: PA.Adm.id,
    name: "quy-dinh.md",
  });
  if (!doc) throw new Error("FIXTURE SAI: seedLibraryDoc null (origin 'library')");
  c.ids.libDoc = doc;
  c.ids.lib = await mk("Adm", libBody("docs-lib", doc, { description: "Quy định nội bộ" }));
  c.ids.beta = await mk("Db", gitBody("beta-repo", { description: "Repo của beta" }));
}

export type StageOpt = {
  key: string;
  sources?: { source_key: string; allowlist: string[] }[];
  must_know?: string[];
  after?: "auto" | "review";
  agent?: string;
  token_budget?: number | null;
};
/** `POST /process-defs` (Adm). Stage mặc định: agent `hd-read`, output `## Bảng ý` + `## Số tiền` (MD_AUTO). */
export async function mkDef(
  c: Ctx3,
  key: string,
  o: { sources?: string[]; inputs?: Json[]; stages: StageOpt[] },
): Promise<string> {
  const stages = o.stages.map((s) => ({
    ...stageDef({
      key: s.key,
      name: s.key,
      executor: { kind: "agent", agent_id: s.agent ?? P1.agRead },
      after: s.after === "review" ? { kind: "review", group_id: PA_FIX.gKeToan } : { kind: "auto" },
      token_budget: s.token_budget ?? null,
    }),
    sources: s.sources ?? [],
    must_know: s.must_know ?? [],
  }));
  const body = {
    ...defInput({ key, name: `Quy trình ${key}`, stages }),
    sources: o.sources ?? [],
    inputs: o.inputs ?? [],
  };
  const r = await c.call("Adm", "POST", "/process-defs", body);
  if (r.status !== 201)
    throw new Error(`FIXTURE SAI POST /process-defs ${key}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.id as string;
}
export const SRC = (key: string, ...allowlist: string[]) => ({ source_key: key, allowlist });

// ---------- bắt đầu run ----------
export async function startRun(
  c: Ctx3,
  key: string,
  o: { role?: Role; input?: string; inputs?: Json[] } = {},
) {
  const res = await c.call(o.role ?? "A", "POST", "/process-runs", {
    process_key: key,
    input: o.input ?? "Yêu cầu thử",
    origin: { kind: "none" },
    ...(o.inputs ? { inputs: o.inputs } : {}),
  });
  return { res, runId: (res.json?.id ?? "") as string };
}

/** Job `source.resolve` của run quy trình (theo thứ tự tạo). */
export const resolveJobs = (sql: Sql, runId: string) =>
  sql<
    { id: string; status: string; payload: Json; error_code: string | null }[]
  >`select id, status, payload, error_code from hub.jobs where payload->>'type' = 'source.resolve'
    and payload->>'process_run_id' = ${runId} order by created_at, id`;

/** Chờ đủ `n` job resolve của run (đỏ ở expect ở nơi gọi nếu Hub chưa phát). */
export async function waitResolveJobs(sql: Sql, runId: string, n = 1, ms = 6_000) {
  return waitFor(
    () => resolveJobs(sql, runId),
    (v) => v.length >= n,
    ms,
  );
}
/** Số `hub.runs` (job agent) của run quy trình. */
export async function agentRunCount(sql: Sql, runId: string): Promise<number> {
  const [r] = await sql<
    { n: number }[]
  >`select count(*)::int as n from hub.runs where process_run_id = ${runId}`;
  return r?.n ?? -1;
}

// ---------- Runtime giả cho `source.resolve` ----------
export type ResolveJob = { id: string; tenant_id: string; payload: Json; token: string };
export type ItemAnswer =
  | { status: "ok"; pin?: Json; files?: number; bytes?: number }
  | { status: "error"; code: string; message?: string };

/** Pin mặc định theo item: git `main` ⇒ C1, nhánh khác ⇒ C2; library ⇒ version `LIB_VERSION`; local ⇒ snapshot. */
export function defaultPin(item: Json): Json {
  const cfg = item.config as Json;
  if (cfg.kind === "git_remote")
    return { kind: "git_remote", url: cfg.url, sha: cfg.branch === "main" ? C1 : C2 };
  if (cfg.kind === "library")
    return { kind: "library", document_id: cfg.document_id, version: LIB_VERSION };
  return { kind: "local_path", path: cfg.path, snapshot_id: X(900) };
}
export function resultFor(item: Json, a: ItemAnswer): Json {
  if (a.status === "error")
    return {
      status: "error",
      source_id: item.source_id,
      code: a.code,
      ...(a.message ? { message: a.message } : {}),
    };
  return {
    status: "ok",
    source_id: item.source_id,
    pin: a.pin ?? defaultPin(item),
    files: a.files ?? 6,
    bytes: a.bytes ?? 2048,
  };
}

const active = new Set<{ stop: () => Promise<void> }>();
export function stopAllResolvers(): Promise<unknown> {
  return Promise.all([...active].map((h) => h.stop()));
}

/**
 * Như Runtime: claim job `source.resolve` `queued` (→ `running`, token mới), trả lời từng item theo `answer(item, job)`:
 * `"silent"` = không trả lời (job giữ `running`). Sau khi POST xong ⇒ `UPDATE hub.jobs SET status='succeeded'`.
 */
export function resolver(
  c: Ctx3,
  answer: (item: Json, job: ResolveJob) => ItemAnswer | "silent" = () => ({ status: "ok" }),
) {
  const seen: ResolveJob[] = [];
  const posts: { jobId: string; status: number; json: Json }[] = [];
  let live = true;
  const loop = (async () => {
    while (live) {
      const rows = await c.sql<
        { id: string; tenant_id: string; payload: Json }[]
      >`select id, tenant_id, payload from hub.jobs where payload->>'type' = 'source.resolve'
        and status = 'queued' order by created_at limit 5`;
      for (const r of rows) {
        const token = newJobToken();
        const upd =
          await c.sql`update hub.jobs set status = 'running', worker_id = 'qc-rt-1', started_at = now(),
          heartbeat_at = now(), token_hash = ${tokenHash(token)} where id = ${r.id} and status = 'queued' returning id`;
        if (upd.length === 0) continue;
        const job: ResolveJob = { id: r.id, tenant_id: r.tenant_id, payload: r.payload, token };
        seen.push(job);
        const items = (job.payload.items ?? []) as Json[];
        const answers = items.map((it) => answer(it, job));
        if (answers.some((a) => a === "silent")) continue;
        const results = items.map((it, i) => resultFor(it, answers[i] as ItemAnswer));
        const res = await postResolved(c, job.id, job.token, { results });
        posts.push({ jobId: job.id, ...res });
        await c.sql`update hub.jobs set status = 'succeeded', finished_at = now() where id = ${job.id} and status = 'running'`;
      }
      await Bun.sleep(40);
    }
  })();
  const handle = {
    seen,
    posts,
    stop: async () => {
      live = false;
      await loop;
      active.delete(handle);
    },
  };
  active.add(handle);
  return handle;
}

/** Claim tay một job resolve của run (RS-*): trả `{id, token, payload}`. */
export async function claimResolve(c: Ctx3, runId: string): Promise<ResolveJob> {
  const jobs = await waitResolveJobs(c.sql, runId, 1);
  const j = jobs.find((x) => x.status === "queued") ?? jobs[0];
  if (!j) throw new Error(`ĐỎ-DO-CHƯA-CODE-S3: Hub chưa phát job source.resolve cho run ${runId}`);
  const token = newJobToken();
  await c.sql`update hub.jobs set status = 'running', worker_id = 'qc-rt-1', started_at = now(), heartbeat_at = now(),
    token_hash = ${tokenHash(token)} where id = ${j.id} and status = 'queued'`;
  return { id: j.id, tenant_id: T.acme, payload: j.payload, token };
}
export const okBody = (payload: Json, a: ItemAnswer = { status: "ok" }): Json => ({
  results: ((payload.items ?? []) as Json[]).map((it) => resultFor(it, a)),
});

export async function postResolved(
  c: { base: string },
  jobId: string,
  token: string | null,
  body: unknown,
): Promise<{ status: number; json: Json; text: string }> {
  const res = await fetch(`${c.base}/internal/jobs/${jobId}/sources-resolved`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

// ---------- Runtime giả cho stage có nguồn ----------
export const refLine = (key: string, path: string, ver: string) => `${key}:${path}@${ver}`;
/** md hợp lệ cho `stageDef()` mặc định (MD_AUTO) + mục `## Nguồn tham chiếu` với `refs` (mỗi dòng 1 ref). */
export const mdWithRefs = (refs: string[], base = MD_AUTO): string =>
  `${base}\n\n## Nguồn tham chiếu\n${refs.join("\n")}\n`;

/** `source_reads` suy từ `refs` (`key:path@ver`): mỗi key một mục, `files_read` = các path. */
export function readsFromRefs(refs: string[], bytes = 100): Json[] {
  const m = new Map<string, string[]>();
  for (const r of refs) {
    const key = r.slice(0, r.indexOf(":"));
    const path = r.slice(r.indexOf(":") + 1, r.lastIndexOf("@"));
    m.set(key, [...(m.get(key) ?? []), path]);
  }
  return [...m].map(([source_key, files_read]) => ({ source_key, files_read, bytes_read: bytes }));
}

/**
 * Như Runtime thật khi stage xong: `usage_logs` + `hub.jobs.result` + XADD `job.result` (C18: kèm `source_reads`).
 * XADD thô (không qua `RunEventSchema` của qc) vì `source_reads` là trường mới của S3. `reads` undefined ⇒ không có trường.
 */
export async function doneRaw(
  c: Ctx3,
  job: Job,
  text: string,
  reads?: Json[],
  tok: { input: number; output: number } = { input: 100, output: 20 },
): Promise<void> {
  await usage(c, job, tok.input, tok.output);
  const output = { kind: "agent_result", result: { status: "done", text } };
  await c.sql`update hub.jobs set status = 'succeeded', result = ${c.sql.json(output)}, finished_at = now(), pgid = null
    where id = ${job.id} and worker_id = ${c.rt.workerId} and status = 'running'`;
  const ev = {
    v: 1,
    job_id: job.id,
    seq: 2,
    at: new Date().toISOString(),
    type: "job.result",
    output,
    usage: { input_tokens: tok.input, output_tokens: tok.output },
    session_resumed: false,
    ...(reads ? { source_reads: reads } : {}),
  };
  await c.redis.xadd(
    runStreamKey(job.runId),
    "MAXLEN",
    "~",
    "10000",
    "*",
    RUN_STREAM_FIELD,
    JSON.stringify(ev),
  );
}
/** Stage xong với `refs` hợp lệ; `reads` mặc định suy từ refs. */
export const doneWithRefs = (c: Ctx3, job: Job, refs: string[], reads?: Json[]) =>
  doneRaw(c, job, mdWithRefs(refs), reads ?? readsFromRefs(refs));

/** Chạy run tới khi stage 0 có job (ok C1) — dùng chung cho ca không quan tâm resolve. */
export async function startPinned(
  c: Ctx3,
  key: string,
  o: { inputs?: Json[]; answer?: Parameters<typeof resolver>[1] } = {},
) {
  const rs = resolver(c, o.answer);
  const s = await startRun(c, key, { inputs: o.inputs });
  if (s.res.status !== 201)
    throw new Error(`start ${key} ⇒ ${s.res.status} ${JSON.stringify(s.res.json)}`);
  const job = await nextStageJob(c, s.runId);
  // "đã ghim" là tiền điều kiện của mọi ca dùng startPinned: launcher phải chờ resolve rồi mới launch (đỏ tới khi S3 xong).
  const pins = (await runRow(c.sql, s.runId)).pinned_sources as unknown[] | null;
  expect({ pinned: Array.isArray(pins) && pins.length > 0 }).toEqual({ pinned: true });
  return { ...s, rs, job };
}

// ---------- chung ----------
export const code = (r: { status: number; json: Json }) => ({
  status: r.status,
  code: r.json?.error?.code as string | undefined,
});
/** `VALIDATION_ERROR` = 400 trong `common.ts` nhưng spec ghi 422 ⇒ chuẩn hoá (như pfs1). */
export const vcode = (r: { status: number; json: Json }) => {
  const c = code(r);
  return { status: c.status === 400 || c.status === 422 ? 422 : c.status, code: c.code };
};

/** Dọn giữa ca: huỷ run mở, kết thúc job/run Hub, xoá job resolve, trả `app-repo` về `main`, reset đồng hồ. */
export async function settle(c: Ctx3): Promise<void> {
  await stopAllResolvers();
  c.clock.off = 0;
  await c.sql`update hub.process_runs set status = 'cancelled', finished_at = now()
    where status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision')`;
  await c.sql`update hub.jobs set status = 'succeeded', finished_at = now() where status in ('queued', 'running')`;
  await c.sql`update hub.runs set status = 'finished', finished_at = now(), owner = null, lease_until = null
    where status = 'running'`;
  await c.sql`update hub.sources set config = jsonb_set(config, '{branch}', '"main"')
    where key in ('app-repo', 'other-repo') and tenant_id = ${T.acme}`;
}
export const sweep = async (c: Ctx3): Promise<Json> => {
  const h = c.hub.handles() as Json;
  return h?.sweepOnce?.();
};
export { gitBody };
