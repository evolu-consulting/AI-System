// HUB-FR-131…134 · HUB-BR-36 · CR-073 · hạ tầng int K1 (test-plan K1 §2): DB sạch P-a + seed PF1 (agent agentic-cli
// hd-read/hd-post, persona A lan · B hoa · Adm tadmin · P padmin) + HAI KH GIẢ của qc (`_khfake.ts`: A ở `localhost` khoá
// KEY.a thấy proj-a/proj-b, B ở `127.0.0.1` khoá KEY.b thấy proj-c) + hub-api thật in-process (Runtime giả `ScriptRuntime`,
// `processLoops:false`) với seam: `kh: {allowedOrigins, timeoutMs}` (= env HUB_KH_ALLOWED_ORIGINS/HUB_KH_TIMEOUT_MS —
// test-plan §8 G1), `hubSecretsKey` (H4b-1 D11), `publicInternalUrl` (H2a), `onProcessHandles` (`khWriteOnce`, G2).
// Secret `kh_api_key` NỀN TẢNG (tenant null) dựng bằng mã hoá đối chứng H4b-1 (`seedSecret`); bảng K1 (spec §4, plan §5) chèn
// bằng owner CHỈ khi migration 0029 + `hub.secrets` có ⇒ trước code ca đỏ ở `needK1` (không PostgresError). Không `it(...)`.
import { expect } from "bun:test";
import { createApp } from "../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../apps/hub-api/src/lib/redis";
import { HUB_API_URL, type HubDeps, makeKeys, REDIS_TEST_URL, sign } from "../H1/_fixtures";
import { PROFILE, testRedis } from "../H1/_hub";
import { type Job, ScriptRuntime } from "../H1/_runtime";
import { newJobToken, tokenHash } from "../H2a/_runtime2";
import { HUB_KEY, seedSecret, tableExists } from "../H4b1/_h4b1";
import {
  api,
  type Json,
  PA,
  PA_FIX,
  type Res,
  type Role,
  type Sql,
  setupPa,
  T,
  waitFor,
} from "../P-a/_support/pa";
import { insertDefPf1, P1, seedPf1 } from "../P-a/pf1/_local";
import { st } from "../P-b2/_support/stages";
import { type KhFake, startKhFake } from "./_khfake";

export { type Job, type Json, P1, PA, PA_FIX, type Res, type Role, type Sql, T, waitFor };

const x = (n: number) => `c1a10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** uuid tất định dải `c1a1…`; ca tự sinh dùng `idK1(base ≥ 1000)`. */
export function idK1(base: number): () => string {
  let n = base;
  return () => x(n++);
}
export const NONE = x(999);

/** Giá trị khoá dễ nhận khi rò (quét "không lộ"). */
export const KEY = {
  a: "qc-K1-keyA-Zx9Pq7Lm-kh",
  b: "qc-K1-keyB-Zx9Pq7Lm-kh",
  wrong: "qc-K1-wrong-Zx9Pq7Lm-kh",
} as const;
export const PROJ = { a: "proj-a", b: "proj-b", c: "proj-c" } as const;

export const K1 = {
  secMain: x(1), // kh_api_key nền tảng = KEY.a (khoá của KH A)
  secAlt: x(2), // kh_api_key nền tảng = KEY.b (khoá của KH B)
  secTenant: x(3), // kh_api_key của tenant acme (CR-073: không nhận ⇒ not_platform)
  secWrong: x(4), // kh_api_key nền tảng, giá trị sai ⇒ KH 401 (kh_key_rejected)
  secProv: x(5), // provider_api_key nền tảng (wrong_kind)
  secMain2: x(7), // kh_api_key nền tảng thứ hai = KEY.a (đổi khoá ⇒ unchecked)
  agLlm: x(21), // agent runtime llm (KH_AGENT_RUNTIME)
  defAuto: x(31), // `k1-auto` a0 (hd-read) auto, a1 (hd-post) auto
  defGate: x(32), // `k1-gate` g0 (hd-read) review Kế toán, g1 (hd-read) auto
  connMain: x(41), // "kh-main" → KH A, secMain, summary_project proj-a, ok
  connAlt: x(42), // "kh-alt" → KH B, secAlt, summary_project null, ok
} as const;
export const CONN = { main: "kh-main", alt: "kh-alt" } as const;

/** Output có `## Tóm tắt` (đủ mục của stage `st()` + Bàn giao). */
export const SUM_TEXT = "TOM-TAT-K1 Đã đối chiếu hoá đơn HD-12, tổng 12 000 000.";
export const mdSum = (summary = SUM_TEXT): string =>
  `## Bảng ý\nHoá đơn HD-12.\n\n## Tổng tiền\n12 000 000\n\n## Tóm tắt\n${summary}\n\n## Bàn giao\nHANDOFF-OK`;
export const MD_NOSUM =
  "## Bảng ý\nHoá đơn HD-12.\n\n## Tổng tiền\n12 000 000\n\n## Bàn giao\nHANDOFF-OK";

const KT = PA_FIX.gKeToan;
export const DEFS = {
  auto: {
    id: K1.defAuto,
    key: "k1-auto",
    name: "K1 tự động",
    stages: [
      st({ key: "a0", name: "A0", agent: P1.agRead }),
      st({ key: "a1", name: "A1", agent: P1.agPost }),
    ],
  },
  gate: {
    id: K1.defGate,
    key: "k1-gate",
    name: "K1 có duyệt",
    stages: [
      st({ key: "g0", name: "G0", agent: P1.agRead, review: KT }),
      st({ key: "g1", name: "G1", agent: P1.agRead }),
    ],
  },
} as const;

// ---------- schema ----------
export async function hasK1Schema(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ ok: boolean }[]>`select to_regclass('hub.kh_connections') is not null
      and to_regclass('hub.agent_kh') is not null and to_regclass('hub.kh_jobs') is not null
      and to_regclass('hub.kh_stage_usage') is not null and to_regclass('hub.kh_writes') is not null as ok`;
  return r?.ok === true;
}
/** Đầu mỗi ca int: đỏ đúng lý do khi chưa có migration 0029 (K1) / 0028 (H4b-1 `hub.secrets`). */
export function needK1(c: { k1: boolean; sec: boolean }): void {
  expect({ migration0029: c.k1, hubSecrets: c.sec }).toEqual({
    migration0029: true,
    hubSecrets: true,
  });
}

// ---------- seed ----------
async function seedSecrets(sql: Sql): Promise<void> {
  const s = (id: string, kind: string, tenantId: string | null, name: string, value: string) =>
    seedSecret(sql, { id, kind, tenantId, name, value });
  await s(K1.secMain, "kh_api_key", null, "kh-key-main", KEY.a);
  await s(K1.secAlt, "kh_api_key", null, "kh-key-alt", KEY.b);
  await s(K1.secTenant, "kh_api_key", T.acme, "kh-key-acme", KEY.a);
  await s(K1.secWrong, "kh_api_key", null, "kh-key-wrong", KEY.wrong);
  await s(K1.secProv, "provider_api_key", null, "prov-k1", "qc-K1-prov-Zx9Pq7Lm");
  await s(K1.secMain2, "kh_api_key", null, "kh-key-main-2", KEY.a);
}

async function seedDefs(sql: Sql): Promise<void> {
  await sql`insert into hub.agents ${sql({
    id: K1.agLlm,
    key: "k1-llm",
    name: sql.json({ vi: "K1 LLM", en: "K1 LLM" }),
    description: "Agent LLM thử cho bộ test K1 (không phải CLI).",
    runtime: "llm",
    profile_id: PROFILE.fake,
    system_prompt: "",
  })}`;
  for (const d of [DEFS.auto, DEFS.gate]) await insertDefPf1(sql, d as Json);
}

export const checkResult = (projects: string[], at = new Date().toISOString()) => ({
  status: "ok",
  checked_at: at,
  kh_version: "v6.4",
  embedder: "BAAI/bge-m3",
  projects,
  items: [],
});
export type ConnSeed = {
  id: string;
  name: string;
  baseUrl: string;
  secretId: string;
  summary: string | null;
  status?: "unchecked" | "ok" | "error";
  projects?: string[];
};
/** Hàng `kh_connections` (owner) — `status ok` kèm `check_result`. */
export async function seedConn(sql: Sql, c: ConnSeed): Promise<void> {
  const status = c.status ?? "ok";
  await sql`insert into hub.kh_connections (id, name, base_url, secret_id, summary_project, check_status,
      checked_at, check_result)
    values (${c.id}, ${c.name}, ${c.baseUrl}, ${c.secretId}, ${c.summary}, ${status},
      ${status === "unchecked" ? null : new Date()},
      ${status === "unchecked" ? null : sql.json(checkResult(c.projects ?? []))})`;
}
/** Agent tick kết nối theo thứ tự (thay toàn bộ). */
export async function tick(sql: Sql, agentId: string, conns: string[]): Promise<void> {
  await sql`delete from hub.agent_kh where agent_id = ${agentId}`;
  for (const [i, id] of conns.entries())
    await sql`insert into hub.agent_kh (agent_id, connection_id, position) values (${agentId}, ${id}, ${i})`;
}
export const setStatus = (sql: Sql, id: string, status: "unchecked" | "ok" | "error") =>
  sql`update hub.kh_connections set check_status = ${status} where id = ${id}`;

/** "full": 2 kết nối ok + hd-read tick [main], hd-post tick [alt, main]. */
export async function seedFull(c: CtxK1): Promise<void> {
  await c.sql`delete from hub.agent_kh`;
  await c.sql`delete from hub.kh_connections`;
  await seedConn(c.sql, {
    id: K1.connMain,
    name: CONN.main,
    baseUrl: c.khA.base,
    secretId: K1.secMain,
    summary: PROJ.a,
    projects: [PROJ.a, PROJ.b],
  });
  await seedConn(c.sql, {
    id: K1.connAlt,
    name: CONN.alt,
    baseUrl: c.khB.base,
    secretId: K1.secAlt,
    summary: null,
    projects: [PROJ.c],
  });
  await tick(c.sql, P1.agRead, [K1.connMain]);
  await tick(c.sql, P1.agPost, [K1.connAlt, K1.connMain]);
}

// ---------- hub-api thật ----------
export type K1Opts = {
  /** "secrets" = chỉ secret + def (Studio tự dựng); "full" = thêm 2 kết nối + agent tick. */
  seed?: "secrets" | "full";
  /** origin thêm vào allowlist (vd origin chết cho `unreachable`). */
  extraOrigins?: string[];
  timeoutMs?: number;
  /** ghi đè allowlist hoàn toàn (vd [] ⇒ không lưu được URL). */
  allowedOrigins?: string[];
};
export type CtxK1 = {
  sql: Sql;
  ready: boolean;
  k1: boolean;
  sec: boolean;
  khA: KhFake;
  khB: KhFake;
  hub: { base: string; handles: () => Json | null; stop: () => Promise<void> };
  rt: ScriptRuntime;
  tok: (r: Role) => Promise<string>;
  call: (r: Role, method: string, path: string, body?: unknown) => Promise<Res>;
  stop: () => Promise<void>;
};

async function startHub(k: Awaited<ReturnType<typeof makeKeys>>, origins: string[], o: K1Opts) {
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: () => new Response("starting", { status: 503 }),
  });
  const base = `http://localhost:${server.port}`;
  let handles: Json | null = null;
  const deps: Record<string, unknown> = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId: "qc-k1-1",
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 4,
    processEngine: true,
    processRunsPerTenant: 50,
    processLoops: false,
    publicInternalUrl: base,
    hubSecretsKey: HUB_KEY,
    kh: { allowedOrigins: o.allowedOrigins ?? origins, timeoutMs: o.timeoutMs ?? 1_000 },
    onProcessHandles: (h: Json) => {
      handles = h;
    },
  };
  const app = createApp(
    { version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] },
    deps as HubDeps,
  );
  server.reload({ fetch: app.fetch });
  return {
    base,
    handles: () => handles,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
}

/** DB sạch + seed + 2 KH giả + hub-api. */
export async function startK1(o: K1Opts = {}): Promise<CtxK1> {
  const khA = startKhFake(KEY.a, [PROJ.a, PROJ.b]);
  const khB = startKhFake(KEY.b, [PROJ.c], "127.0.0.1");
  const { sql, ready } = await setupPa();
  if (ready) {
    await seedPf1(sql);
    await seedDefs(sql);
  }
  const k1 = ready && (await hasK1Schema(sql));
  const sec = ready && (await tableExists(sql));
  if (sec) await seedSecrets(sql);
  const k = await makeKeys();
  const hub = await startHub(k, [khA.origin, khB.origin, ...(o.extraOrigins ?? [])], o);
  const redis = await testRedis();
  const rt = new ScriptRuntime(sql, redis);
  const tok = (r: Role) => sign(k, PA[r]);
  const c: CtxK1 = {
    sql,
    ready,
    k1,
    sec,
    khA,
    khB,
    hub,
    rt,
    tok,
    call: async (r, method, path, body) => api(hub as never, await tok(r), method, path, body),
    stop: async () => {
      await hub.stop();
      redis.disconnect();
      await khA.close();
      await khB.close();
      await sql.end();
    },
  };
  if (k1 && sec && o.seed === "full") await seedFull(c);
  return c;
}

/** `/studio/api/kh/connections…` bởi persona (mặc định P = platform_admin). */
export const studio = (c: CtxK1, method: string, path: string, body?: unknown, r: Role = "P") =>
  c.call(r, method, `/studio/api/kh/connections${path}`, body);
/** `PUT /studio/api/agents/:id/knowledge`. */
export const putAgentKh = (c: CtxK1, agentId: string, body: unknown, r: Role = "P") =>
  c.call(r, "PUT", `/studio/api/agents/${agentId}/knowledge`, body);

/** `ProcessHandles.khWriteOnce()` (seam test-plan §8 G2): một lượt bộ gửi Tóm tắt. Vắng ⇒ đỏ ở expect. */
export async function khWriteOnce(c: CtxK1): Promise<number> {
  const h = c.hub.handles();
  expect({ khWriteOnce: typeof h?.khWriteOnce }).toEqual({ khWriteOnce: "function" });
  return Number(await h.khWriteOnce());
}

/** Gán token job (như Runtime nhận khi claim) để gọi `/mcp`. */
export async function jobToken(sql: Sql, job: Job): Promise<string> {
  const t = newJobToken();
  await sql`update hub.jobs set token_hash = ${tokenHash(t)} where id = ${job.id}`;
  return t;
}

export async function auditSinceK1(sql: Sql, from: number, entity?: string): Promise<Json[]> {
  const rows = await sql`select * from hub.audit_log where seq > ${from}
    and (${entity ?? null}::text is null or entity = ${entity ?? null}::text) order by seq`;
  return rows.map((r) => ({ ...r }));
}
export async function auditMaxK1(sql: Sql): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select coalesce(max(seq), 0)::int as n from hub.audit_log`;
  return r?.n ?? 0;
}
export async function configVersion(sql: Sql): Promise<number> {
  const [r] = await sql<
    { v: number }[]
  >`select hub_config_version as v from hub.config_meta where id = 1`;
  return r?.v ?? -1;
}
export async function connRow(sql: Sql, id: string): Promise<Json | undefined> {
  const [r] = await sql`select * from hub.kh_connections where id = ${id}`;
  return r ? { ...r } : undefined;
}
export async function agentKh(sql: Sql, agentId: string): Promise<string[]> {
  const rows = await sql<
    { connection_id: string }[]
  >`select connection_id from hub.agent_kh where agent_id = ${agentId} order by position`;
  return rows.map((r) => r.connection_id);
}
export const errCode = (r: Res): string | undefined => r.json?.error?.code;
export const errDetails = (r: Res): Json => r.json?.error?.details;
