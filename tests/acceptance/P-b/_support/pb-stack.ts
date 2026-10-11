// P-b · PF-S2 · WRK-FR-27 · hạ tầng stack Runtime Python thật (test-plan §0, §1, §2, §2.1; mẫu `H2c/stack/_stack.ts`).
// Hub THẬT (process, host) + Runtime THẬT (container Linux, `fake-cli`) + repo git bare cục bộ TRONG container (`/fixtures`).
// Quan sát (test-plan §4.2): (i) `POST /admin/sources/:key/check` qua Hub; (ii) job `agent.cli` của "stage" dựng bằng SQL
// (payload hợp `JobPayloadSchema`, có `sources[]`) rồi đọc `hub.jobs.result` + sự kiện Redis `run:<id>`; (iii) thư mục
// `/fixtures/markers`. Stage dựng bằng SQL ⇒ nhóm S2 độc lập với S3 (launcher/ghim): pin lấy thẳng từ `git rev-parse`.
// Hạ tầng tự lo (không đụng image): `git` cài lúc khởi động container nếu thiếu (apt, cache trong volume docker `qc-pb-apt-*`).
// Không chứa `it(...)`. Chạy: `bun --env-file=.env.test-qc.local --config=bunfig.stack.toml test --timeout 300000 <file>`.
import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JobPayloadSchema } from "@ai/contracts/hub";
import { dockerArgs, IMAGE } from "../../../../apps/agent-runtime/scripts/run";
import { AGENT_RT_URL, makeKeys, REDIS_TEST_URL, sign } from "../../H1/_fixtures";
import { collectRunEvents } from "../../H1/stack/_stack";
import { HOST_ALIAS, type HubProc, startHubProcH2a } from "../../H2a/stack/_stack";
import {
  AGB,
  api,
  type Json,
  PA,
  type Res,
  type Role,
  type Sql,
  setupPa,
  T,
  waitFor,
} from "../../P-a/_support/pa";
import {
  APP_C1_FILES,
  appRepoScript,
  CACHE,
  FX,
  localRootsScript,
  MARKERS,
  ROOT,
  urlOf,
} from "./pb-fixtures";

export * from "./pb-fixtures";
export { type Json, PA, type Res, type Role, type Sql, T, waitFor };

const REPO = resolve(import.meta.dir, "../../../..");
const docker = (args: string[], input?: string) =>
  Bun.spawnSync(["docker", ...args], {
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    ...(input === undefined ? {} : { stdin: Buffer.from(input) }),
  });
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

export type PbStack = {
  sql: Sql;
  hub: HubProc;
  rtName: string;
  tok: (r: Role) => Promise<string>;
  /** Gọi Hub (JSON) bằng persona. */
  call: (r: Role, method: string, path: string, body?: unknown) => Promise<Res>;
  /** Chạy script `sh` trong container Runtime (root). */
  sh: (script: string) => { code: number; out: string };
  logs: () => string;
  stop: () => Promise<void>;
  /** Đã có một lần `check` quá hạn (Runtime không claim `source.resolve`) ⇒ các check sau thất bại ngay. */
  latched: { v: string | null };
};

export type PbOpts = { cacheMaxMb?: number };
export const RESOLVE_WAIT_MS = 35_000;

function runtimeEnv(hubUrl: string, worker: string, o: PbOpts): Record<string, string> {
  return {
    APP_ENV: "test",
    AGENT_RT_DATABASE_URL: inNet(AGENT_RT_URL, "postgres", 5432),
    REDIS_URL: inNet(REDIS_TEST_URL, "redis", 6379),
    AGENT_RT_WORKER_ID: worker,
    AGENT_RT_PROVIDERS: "fake-cli",
    AGENT_RT_HUB_URL: hubUrl,
    HOME: "/tmp/qc-home",
    AGENT_RT_WORK_DIR: "/tmp/qc-work",
    AGENT_RT_LOG_DIR: "/tmp/qc-logs",
    AGENT_RT_CLEANUP_S: "600",
    // P-b (spec §7 + plan §2 C6)
    HUB_SOURCE_GIT_HOSTS: "github.com,gitlab.com",
    HUB_SOURCE_LOCAL_ROOTS: ROOT,
    RUNTIME_SOURCE_CACHE_DIR: CACHE,
    RUNTIME_ENV: "test",
    RUNTIME_SOURCE_TEST_MODE: "1",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "url./fixtures/.insteadOf",
    GIT_CONFIG_VALUE_0: "https://github.com/pb-test/",
    GIT_CONFIG_KEY_1: "protocol.file.allow",
    GIT_CONFIG_VALUE_1: "always",
    ...(o.cacheMaxMb ? { RUNTIME_SOURCE_CACHE_MAX_MB: String(o.cacheMaxMb) } : {}),
  };
}

function inNet(url: string, host: string, port: number): string {
  const u = new URL(url);
  u.hostname = host;
  u.port = String(port);
  return u.toString();
}

const BOOT = [
  "mkdir -p /tmp/qc-home/.claude /tmp/qc-work /tmp/qc-logs /fixtures/markers /cache",
  `echo '{"token":"qc-canary"}' > /tmp/qc-home/.claude/.credentials.json`,
  "rm -f /etc/apt/apt.conf.d/docker-clean",
  `echo 'APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/99keep`,
  `(command -v git >/dev/null 2>&1 || apt-get install -y -qq --no-install-recommends git >/dev/null 2>&1 || (apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq --no-install-recommends git >/dev/null 2>&1))`,
  "(uv sync --frozen 2>/dev/null || uv sync) >/dev/null 2>&1",
  "exec /opt/venv/bin/python -m agent_runtime",
].join("; ");

/** Container Runtime có `git`, `/fixtures`, `/cache`, env P-b. Chờ log `runtime.start`. */
async function startRuntimePb(name: string, hubUrl: string, o: PbOpts): Promise<void> {
  docker(["rm", "-f", name]);
  const env = runtimeEnv(hubUrl, `${name}-1`, o);
  const args = dockerArgs(REPO.split("\\").join("/"), BOOT).filter((a) => a !== "--rm");
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  args.splice(
    1,
    0,
    "-d",
    "--name",
    name,
    "--add-host",
    `${HOST_ALIAS}:host-gateway`,
    "-v",
    "qc-pb-apt-lists:/var/lib/apt/lists",
    "-v",
    "qc-pb-apt-archives:/var/cache/apt/archives",
    ...envArgs,
  );
  const r = docker(args);
  if (r.exitCode !== 0) throw new Error(`docker run (${IMAGE}) lỗi: ${dec(r.stderr)}`);
  const logs = () => {
    const l = docker(["logs", name]);
    return dec(l.stdout) + dec(l.stderr);
  };
  const up = await waitFor(
    async () => logs(),
    (l) => l.includes("runtime.start") || l.includes("runtime.config_invalid"),
    240_000,
  );
  if (!up.includes("runtime.start")) {
    docker(["rm", "-f", name]);
    throw new Error(`agent-runtime không khởi động được; log: ${up.slice(-800)}`);
  }
}

/** Dựng toàn bộ: DB P-a sạch + Hub thật + Runtime thật + fixture app-repo/local roots. */
export async function bootPb(tag: string, o: PbOpts = {}): Promise<PbStack> {
  const attachDir = await mkdtemp(join(tmpdir(), "qc-pb-stack-"));
  process.env.HUB_ATTACH_DRIVER = "local";
  process.env.HUB_ATTACH_DIR = attachDir;
  process.env.HUB_PROCESS_ENGINE = "on";
  process.env.HUB_SOURCE_GIT_HOSTS = "github.com,gitlab.com";
  process.env.HUB_MAX_CONCURRENT_RUNS = "2";
  const { sql } = await setupPa();
  const k = await makeKeys();
  const hub = await startHubProcH2a(k);
  const rtName = `qc-pb-s2-${tag}`;
  await startRuntimePb(rtName, hub.publicUrl, o);
  const sh = (script: string) => shIn(rtName, script);
  const st: PbStack = {
    sql,
    hub,
    rtName,
    sh,
    tok: (r) => sign(k, PA[r]),
    call: async (r, method, path, body) => api(hub, await sign(k, PA[r]), method, path, body),
    logs: () => {
      const l = docker(["logs", rtName]);
      return dec(l.stdout) + dec(l.stderr);
    },
    latched: { v: null },
    stop: async () => {
      docker(["rm", "-f", rtName]);
      await hub.stop();
      await sql.end();
      await rm(attachDir, { recursive: true, force: true });
    },
  };
  must(sh(appRepoScript()), "dựng app-repo");
  must(sh(localRootsScript()), "dựng local roots");
  return st;
}

export function shIn(name: string, script: string): { code: number; out: string } {
  const p = docker(["exec", "-i", name, "sh", "-s"], script);
  return { code: p.exitCode ?? 1, out: (dec(p.stdout) + dec(p.stderr)).trim() };
}

/** Script fixture phải chạy được: lỗi ở đây là fixture sai, KHÔNG phải đỏ-do-chưa-code. */
export function must(r: { code: number; out: string }, what: string): string {
  if (r.code !== 0) throw new Error(`FIXTURE SAI (${what}): exit ${r.code}: ${r.out.slice(-600)}`);
  return r.out;
}

/** SHA đầu `ref` của repo bare `/fixtures/<repo>.git`. */
export function revParse(st: PbStack, repo: string, ref = "main"): string {
  return must(st.sh(`git -C ${FX}/${repo}.git rev-parse ${ref}`), `rev-parse ${repo}@${ref}`);
}
/** Tổng cỡ (byte) các đường dẫn tại `ref`. */
export function bytesAt(st: PbStack, repo: string, ref: string, paths: readonly string[]): number {
  const out = must(
    st.sh(paths.map((p) => `git -C ${FX}/${repo}.git cat-file -s ${ref}:${p}`).join("\n")),
    "cat-file -s",
  );
  return out.split("\n").reduce((n, l) => n + Number(l), 0);
}
export const markerExists = (st: PbStack, name: string): boolean =>
  st.sh(`test -e ${MARKERS}/${name}`).code === 0;
export const clearCache = (st: PbStack): void => {
  must(st.sh(`rm -rf ${CACHE}/* ${CACHE}/.[!.]* 2>/dev/null; mkdir -p ${CACHE}`), "xoá cache");
};

// ---------- nguồn qua Hub ----------
export const gitPin = (repo: string, sha: string): Json => ({
  kind: "git_remote",
  url: urlOf(repo),
  sha,
});
export const gitSrcBody = (key: string, repo: string, branch = "main"): Json => ({
  key,
  kind: "git_remote",
  config: { kind: "git_remote", url: urlOf(repo), branch },
  description: `Nguồn ${key}`,
});
export const localSrcBody = (key: string, path: string): Json => ({
  key,
  kind: "local_path",
  config: { kind: "local_path", path },
  description: `Thư mục ${key}`,
  tenant_id: T.acme,
});

/** Chèn nguồn thẳng SQL (bỏ validate của CRUD — cấu hình "độc"). Trả `id`. */
export async function sqlSource(
  st: PbStack,
  o: { tenant?: string; key: string; kind: string; config: Json },
): Promise<string> {
  const id = crypto.randomUUID();
  await st.sql`insert into hub.sources (id, tenant_id, key, kind, config, description, version)
    values (${id}, ${o.tenant ?? T.acme}, ${o.key}, ${o.kind}, ${st.sql.json(o.config)}, ${`Nguồn ${o.key}`}, 1)`;
  return id;
}

export async function createSource(st: PbStack, role: Role, body: Json): Promise<Res> {
  const r = await st.call(role, "POST", "/admin/sources", body);
  expect({ create: body.key, status: r.status }).toEqual({ create: body.key, status: 201 });
  return r;
}

export type CheckOut = { status: number; json: Json; text: string; ms: number };
/**
 * `POST /admin/sources/:key/check`. Quá `RESOLVE_WAIT_MS` ⇒ Runtime không claim/trả lời `source.resolve` (S2 chưa có):
 * ném lỗi RÕ và chốt `latched` để các ca sau cùng file thất bại ngay (không chờ 35 s × N).
 */
export async function checkSource(
  st: PbStack,
  role: Role,
  key: string,
  tenant?: string,
): Promise<CheckOut> {
  if (st.latched.v) throw new Error(st.latched.v);
  const t0 = Date.now();
  const q = tenant ? `?tenant_id=${tenant}` : "";
  try {
    const res = await fetch(`${st.hub.base}/admin/sources/${key}/check${q}`, {
      method: "POST",
      headers: { authorization: `Bearer ${await st.tok(role)}` },
      signal: AbortSignal.timeout(RESOLVE_WAIT_MS),
    });
    const text = await res.text();
    let json: Json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, ms: Date.now() - t0 };
  } catch (e) {
    const js = await st.sql<
      { status: string; n: number }[]
    >`select status, count(*)::int as n from hub.jobs
      where payload->>'type' = 'source.resolve' group by status`;
    const seen = js.map((j) => `${j.status}=${j.n}`).join(",") || "không có job";
    st.latched.v = `ĐỎ-DO-CHƯA-CODE-S2: check "${key}" không trả sau ${Date.now() - t0} ms — Runtime không claim/trả lời job source.resolve [hub.jobs source.resolve: ${seen}] (${String(e)})`;
    throw new Error(st.latched.v);
  }
}
export const errCode = (r: { status: number; json: Json }) => ({
  status: r.status,
  code: r.json?.error?.code as string | undefined,
});

// ---------- "stage" agent.cli bằng SQL ----------
export type StageSrc = { key: string; kind?: string; pin: Json; allowlist?: string[] };
export type StageOut = {
  jobId: string;
  runId: string;
  status: string;
  errorCode: string | null;
  text: string;
  result: Json;
  events: Json[];
};
type RunCtx = { runId: string; convId: string; flowId: string };

import { readFileSync } from "node:fs";

const AGENT_FIXTURE = JSON.parse(
  readFileSync(
    new URL(
      "../../../../packages/contracts/fixtures/hub/valid/JobPayload.agent-mcp.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Json;

/** Run `running` (chủ instance khác, lease 1 giờ) cho một người dùng; trả id để gắn nhiều job (CA-04). */
export async function openRun(st: PbStack, who: Role = "A"): Promise<RunCtx> {
  const u = PA[who];
  const [convId, flowId, msgU, msgA, runId] = Array.from({ length: 5 }, () =>
    crypto.randomUUID(),
  ) as string[] as [string, string, string, string, string];
  await st.sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm)
    values (${convId}, ${u.tid}, ${u.id}, 'Stage nguồn', 'stage nguon')`;
  await st.sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
    values (${flowId}, ${u.tid}, ${u.id}, ${convId}, 'Stage nguồn', 2)`;
  await st.sql`insert into hub.messages (id, tenant_id, user_id, conversation_id, flow_id, role, content, run_id) values
    (${msgU}, ${u.tid}, ${u.id}, ${convId}, ${flowId}, 'user', 'việc thử', null),
    (${msgA}, ${u.tid}, ${u.id}, ${convId}, ${flowId}, 'assistant', '', ${runId})`;
  await st.sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, owner, lease_until, locale)
    values (${runId}, ${u.tid}, ${u.id}, ${convId}, ${flowId}, 'running', 1, ${msgU}, ${msgA},
      'qc-other-instance', now() + interval '1 hour', 'vi')`;
  return { runId, convId, flowId };
}

export type StageOpts = {
  /** `prompt` = chỉ thị fake-cli, vd `#fake:tree=sources/app-repo`. */
  prompt: string;
  sources?: StageSrc[];
  tools?: string[];
  who?: Role;
  run?: RunCtx;
  waitMs?: number;
};

/** Dựng + chờ job `agent.cli` (provider fake-cli) tới trạng thái cuối; thu `run:<id>` events. */
export async function runStage(st: PbStack, o: StageOpts): Promise<StageOut> {
  const u = PA[o.who ?? "A"];
  const run = o.run ?? (await openRun(st, o.who ?? "A"));
  const [ag] = await st.sql<{ key: string }[]>`select key from hub.agents where id = ${AGB.hoadon}`;
  const agentKey = ag?.key ?? "hoadon";
  const [jobId, stepId] = [crypto.randomUUID(), crypto.randomUUID()] as [string, string];
  const sources = o.sources?.map((s) => ({
    key: s.key,
    kind: s.kind ?? s.pin.kind,
    pin: s.pin,
    allowlist: s.allowlist ?? [],
  }));
  const payload = {
    ...AGENT_FIXTURE,
    job_id: jobId,
    run_id: run.runId,
    step_id: stepId,
    tenant_id: u.tid,
    user_id: u.id,
    conversation_id: run.convId,
    flow_id: run.flowId,
    feature_id: null,
    agent_type_key: null,
    mcp: null,
    agent: { id: AGB.hoadon, key: agentKey, role: "agent" },
    provider_key: "fake-cli",
    model: null,
    profile_steps: [{ provider_key: "fake-cli", model: null, on: [] }],
    step_index: 0,
    prompt: o.prompt,
    history: [],
    use_session: false,
    allowed_tools: o.tools ?? ["Read", "Grep", "Glob"],
    output: "agent_result",
    timeout_s: 120,
    ...(sources ? { sources } : {}),
  };
  const parsed = JobPayloadSchema.safeParse(payload);
  expect({ payload_valid: parsed.success }).toEqual({ payload_valid: true }); // contract P-b đã có ⇒ fixture đúng
  const col = await collectRunEvents(run.runId);
  const [seqRow] = await st.sql<
    { n: number }[]
  >`select coalesce(max(seq), 0) + 1 as n from hub.run_steps
    where run_id = ${run.runId}`;
  await st.sql`insert into hub.run_steps (id, tenant_id, user_id, run_id, seq, type, agent_id, provider_key, job_id,
      label_key, status) values (${stepId}, ${u.tid}, ${u.id}, ${run.runId}, ${seqRow?.n ?? 1}, 'delegate', ${AGB.hoadon}, 'fake-cli',
      ${jobId}, 'step.delegate', 'running')`;
  await st.sql`insert into hub.jobs (id, tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
      provider_key, payload, status, attempts) values (${jobId}, ${u.tid}, ${u.id}, ${run.runId}, ${stepId},
      ${run.convId}, ${AGB.hoadon}, 'agent.cli', 'fake-cli', ${st.sql.json(payload as never)}, 'queued', 0)`;
  await st.sql.notify("job_enqueued", "");
  const row = await waitFor(
    async () => {
      const [r] = await st.sql<
        Json[]
      >`select status, result, error_code from hub.jobs where id = ${jobId}`;
      return r;
    },
    (r) => ["succeeded", "failed", "cancelled", "timed_out"].includes(r?.status),
    o.waitMs ?? 90_000,
  );
  await Bun.sleep(300); // cho collector gom nốt sự kiện cuối
  col.stop();
  const res = row?.result ?? null;
  // hub.jobs.result = JobOutput {kind:"agent_result", result:{status, text}} | {kind:"text", text}
  const text = res?.result?.text ?? res?.text ?? "";
  return {
    jobId,
    runId: run.runId,
    status: row?.status ?? "timeout",
    errorCode: row?.error_code ?? null,
    text,
    result: res,
    events: col.events,
  };
}

// ---------- đọc đầu ra directive fake-cli (test-plan §2) ----------
export type TreeEntry = { path: string; type: string; mode: number };
/** `tree <dir>` + dòng `<path> <f|d|l> <mode>`; `ENOENT` ⇒ `null`. */
export function parseTree(text: string): TreeEntry[] | null {
  const lines = text.split("\n").filter(Boolean);
  if (lines[0]?.startsWith("tree ") && lines[0].endsWith(" ENOENT")) return null;
  return lines
    .filter((l) => !l.startsWith("tree "))
    .map((l) => {
      const [path = "", type = "", mode = "0"] = l.split(" ");
      return { path, type, mode: Number.parseInt(mode, 8) };
    });
}
export const filesOf = (t: TreeEntry[] | null): string[] =>
  (t ?? [])
    .filter((e) => e.type === "f")
    .map((e) => e.path)
    .sort();
/** `read <path> <sha256|ENOENT|DENIED>` ⇒ { path: value }. */
export function parseReads(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of text.split("\n")) {
    const m = /^read (\S+) (\S+)$/.exec(l.trim());
    if (m) out[m[1] as string] = m[2] as string;
  }
  return out;
}

/** Cây của nguồn `key` trong một stage (mount `sources/<key>`). */
export async function treeOf(
  st: PbStack,
  src: StageSrc,
  extra: Partial<StageOpts> = {},
): Promise<{ out: StageOut; files: string[] | null; entries: TreeEntry[] | null }> {
  const out = await runStage(st, {
    prompt: `#fake:tree=sources/${src.key}`,
    sources: [src],
    ...extra,
  });
  const entries = parseTree(out.text);
  return { out, files: entries === null ? null : filesOf(entries), entries };
}

/** Chứng minh cây KHÔNG phải rỗng-do-chưa-code: job phải `succeeded` và in đúng dòng `tree`. */
export function expectTreeOk(out: StageOut): void {
  expect({ status: out.status, error: out.errorCode, head: out.text.split("\n")[0] }).toMatchObject(
    {
      status: "succeeded",
      head: expect.stringMatching(/^tree /),
    },
  );
}

/** Xoá dữ liệu mỗi ca (giữ seed P-a): nguồn, job resolve. */
export async function resetPb(st: PbStack): Promise<void> {
  st.latched.v = null;
  await st.sql`delete from hub.jobs where payload->>'type' = 'source.resolve'`;
  const t = await st.sql`select to_regclass('hub.sources') as r`;
  if (t[0]?.r) await st.sql`delete from hub.sources`;
}

export const APP_FILES = APP_C1_FILES;
