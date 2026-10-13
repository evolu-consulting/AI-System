// HUB-FR-131…134 · HUB-FR-137 · HUB-BR-35 · HUB-BR-36 · hạ tầng int K1 (test-plan K1 §2): DB sạch P-a + seed PF1 (agent
// agentic-cli hd-read/hd-post, persona A lan · B hoa · Adm tadmin · P padmin · Db tadmin_beta) + KH GIẢ của qc (`_khfake.ts`)
// + hub-api thật in-process (launcher thật, Runtime giả `ScriptRuntime`, `processLoops:false`) với seam:
//   `kh: {allowedOrigins, timeoutMs}` (= env HUB_KH_ALLOWED_ORIGINS/HUB_KH_TIMEOUT_MS — test-plan §8 G1),
//   `hubSecretsKey` (H4b-1 D11), `publicInternalUrl` (H2a — `mcp.url` của job).
// Secret `kh_api_key` dựng bằng owner theo mã hoá đối chứng H4b-1 (`seedSecret`); bảng K1 (spec §4, plan §5) chèn bằng
// owner CHỈ khi migration 0029 + `hub.secrets` có (`k1`/`sec`) ⇒ trước code ca đỏ ở `needK1` (không PostgresError).
// Không chứa `it(...)`. jsonb qua `sql.json`.
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
import { type KhFake, nsDefaults, startKhFake } from "./_khfake";

export { type Job, type Json, P1, PA, PA_FIX, type Res, type Role, type Sql, T, waitFor };

const x = (n: number) => `c1a10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** uuid tất định dải `c1a1…`; ca tự sinh dùng `idK1(base ≥ 1000)`. */
export function idK1(base: number): () => string {
  let n = base;
  return () => x(n++);
}
export const NONE = x(999);

export const NS = { acme: "acme_ns", beta: "beta_ns" } as const;
export const PROJ = { a: "proj-a", b: "proj-b", shared: "proj-shared", beta: "proj-beta" } as const;
/** Giá trị client_secret dễ nhận khi rò (quét "không lộ"). */
export const CS = { acme: "qc-K1-acme-Zx9Pq7Lm-cs", beta: "qc-K1-beta-Zx9Pq7Lm-cs" } as const;
export const cred = (ns: string, secret: string, extra: Json = {}): string =>
  JSON.stringify({ client_id: `kh-ns-${ns}`, client_secret: secret, ...extra });

export const K1 = {
  secAcme: x(1), // kh_api_key acme — credentials đúng acme_ns
  secBeta: x(2), // kh_api_key beta — credentials đúng beta_ns
  secAcmeBad: x(3), // kh_api_key acme — giá trị không phải JSON credentials
  secAcmeWrong: x(4), // kh_api_key acme — JSON đúng dạng, client_secret sai ⇒ KH 401
  secProv: x(5), // provider_api_key (nền tảng)
  secPlatKh: x(6), // kh_api_key tenant null (Q7: K1 không nhận)
  secAcme2: x(7), // kh_api_key acme thứ hai (đổi secret ⇒ unchecked)
  agLlm: x(21), // agent runtime llm (KH_AGENT_RUNTIME)
  defAuto: x(31), // `k1-auto` 2 stage auto, gắn proj-a
  defGate: x(32), // `k1-gate` stage 0 review Kế toán, stage 1 auto, gắn proj-a
  defShared: x(33), // `k1-shared` 1 stage auto, gắn proj-shared (chỉ đọc)
  defNone: x(34), // `k1-none` 1 stage auto, KHÔNG gắn (AC07 quy trình khác)
  defMixed: x(35), // `k1-mixed` m0 tắt (override null), m1 theo quy trình proj-a
  defBeta: x(36), // `k1-beta` (tenant beta)
  defFree: x(37), // `k1-free` (acme) — dùng cho ca PUT binding qua API
} as const;

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
  shared: {
    id: K1.defShared,
    key: "k1-shared",
    name: "K1 dùng chung",
    stages: [st({ key: "r0", name: "R0", agent: P1.agRead })],
  },
  none: {
    id: K1.defNone,
    key: "k1-none",
    name: "K1 không tri thức",
    stages: [st({ key: "n0", name: "N0", agent: P1.agRead })],
  },
  mixed: {
    id: K1.defMixed,
    key: "k1-mixed",
    name: "K1 trộn",
    stages: [
      st({ key: "m0", name: "M0", agent: P1.agRead }),
      st({ key: "m1", name: "M1", agent: P1.agRead }),
    ],
  },
  free: {
    id: K1.defFree,
    key: "k1-free",
    name: "K1 tự do",
    stages: [
      st({ key: "f0", name: "F0", agent: P1.agRead }),
      st({ key: "f1", name: "F1", agent: P1.agRead }),
    ],
  },
} as const;

// ---------- schema ----------
export async function hasK1Schema(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ ok: boolean }[]>`select to_regclass('hub.kh_tenants') is not null
      and to_regclass('hub.kh_writes') is not null
      and exists (select 1 from information_schema.columns where table_schema = 'hub'
                  and table_name = 'agents' and column_name = 'knowledge_enabled') as ok`;
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
async function seedSecrets(sql: Sql): Promise<boolean> {
  const s = async (
    id: string,
    kind: string,
    tenantId: string | null,
    name: string,
    value: string,
  ) => seedSecret(sql, { id, kind, tenantId, name, value });
  if (!(await s(K1.secAcme, "kh_api_key", T.acme, "kh-acme", cred(NS.acme, CS.acme)))) return false;
  await s(K1.secBeta, "kh_api_key", T.beta, "kh-beta", cred(NS.beta, CS.beta));
  await s(K1.secAcmeBad, "kh_api_key", T.acme, "kh-acme-bad", "qc-K1-not-json-Zx9Pq7Lm");
  await s(
    K1.secAcmeWrong,
    "kh_api_key",
    T.acme,
    "kh-acme-wrong",
    cred(NS.acme, "qc-K1-wrong-Zx9Pq7Lm"),
  );
  await s(K1.secProv, "provider_api_key", null, "prov-k1", "qc-K1-prov-Zx9Pq7Lm");
  await s(K1.secPlatKh, "kh_api_key", null, "kh-platform", cred(NS.acme, CS.acme));
  await s(K1.secAcme2, "kh_api_key", T.acme, "kh-acme-2", cred(NS.acme, CS.acme));
  return true;
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
  for (const d of [DEFS.auto, DEFS.gate, DEFS.shared, DEFS.none, DEFS.mixed, DEFS.free])
    await insertDefPf1(sql, d as Json);
  await insertDefPf1(
    sql,
    { id: K1.defBeta, key: "k1-beta", name: "K1 beta", stages: [st({ key: "b0" })] },
    {
      tenantId: T.beta,
    },
  );
}

export type TenantSeed = {
  status?: "unchecked" | "ok" | "error";
  enabled?: boolean;
  secretId?: string | null;
};
/** Hàng `kh_tenants` + project (owner). `check_result` có `keyspace_dims` (D13). */
export async function seedTenant(
  sql: Sql,
  tenant: string,
  ns: string,
  projects: { id: string; ro?: boolean }[],
  o: TenantSeed = {},
): Promise<void> {
  const status = o.status ?? "ok";
  const result = { kh_version: "v6.4", keyspace_dims: ["role", "step"], items: [] };
  await sql`insert into hub.kh_tenants (tenant_id, ns, secret_id, keyspace, enabled, check_status, checked_at, check_result)
    values (${tenant}, ${ns}, ${o.secretId === undefined ? (tenant === T.acme ? K1.secAcme : K1.secBeta) : o.secretId},
      'step', ${o.enabled ?? true}, ${status}, ${status === "unchecked" ? null : new Date()},
      ${status === "unchecked" ? null : sql.json(result)})`;
  for (const p of projects)
    await sql`insert into hub.kh_projects (tenant_id, project_id, label, read_only)
      values (${tenant}, ${p.id}, ${p.id.toUpperCase()}, ${p.ro ?? false})`;
}
export async function seedBinding(
  sql: Sql,
  defId: string,
  tenant: string,
  projectId: string | null,
  stageProjects: Record<string, string | null> = {},
): Promise<void> {
  await sql`insert into hub.kh_bindings (process_def_id, tenant_id, project_id, stage_projects)
    values (${defId}, ${tenant}, ${projectId}, ${sql.json(stageProjects)})`;
}
export const setBaseUrl = (sql: Sql, url: string | null) =>
  sql`update hub.kh_settings set base_url = ${url} where id = 1`;
export const setKnowledge = (sql: Sql, agentId: string, on: boolean) =>
  sql`update hub.agents set knowledge_enabled = ${on} where id = ${agentId}`;

/** "full": settings + acme (proj-a, proj-b, proj-shared RO) + beta (proj-beta) hiệu lực + binding 4 def + agent tri thức. */
async function seedFull(sql: Sql, kh: KhFake): Promise<void> {
  await setBaseUrl(sql, kh.base);
  await seedTenant(sql, T.acme, NS.acme, [
    { id: PROJ.a },
    { id: PROJ.b },
    { id: PROJ.shared, ro: true },
  ]);
  await seedTenant(sql, T.beta, NS.beta, [{ id: PROJ.beta }]);
  await seedBinding(sql, K1.defAuto, T.acme, PROJ.a);
  await seedBinding(sql, K1.defGate, T.acme, PROJ.a);
  await seedBinding(sql, K1.defShared, T.acme, PROJ.shared);
  await seedBinding(sql, K1.defMixed, T.acme, PROJ.a, { m0: null });
  await seedBinding(sql, K1.defBeta, T.beta, PROJ.beta);
  await setKnowledge(sql, P1.agRead, true);
  await setKnowledge(sql, P1.agPost, true);
}

// ---------- hub-api thật ----------
export type K1Opts = {
  /** "secrets" = chỉ secret + def (Studio tự dựng); "full" = thêm cấu hình KH hiệu lực + binding. */
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
  kh: KhFake;
  hub: { base: string; handles: () => Json | null; stop: () => Promise<void> };
  rt: ScriptRuntime;
  tok: (r: Role) => Promise<string>;
  call: (r: Role, method: string, path: string, body?: unknown) => Promise<Res>;
  stop: () => Promise<void>;
};

async function startHub(k: Awaited<ReturnType<typeof makeKeys>>, kh: KhFake, o: K1Opts) {
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
    kh: {
      allowedOrigins: o.allowedOrigins ?? [kh.origin, ...(o.extraOrigins ?? [])],
      timeoutMs: o.timeoutMs ?? 1_000,
    },
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

/** DB sạch + seed + KH giả + hub-api. KH giả có sẵn ns acme_ns/beta_ns (credentials khớp secret), project acme đủ 3. */
export async function startK1(o: K1Opts = {}): Promise<CtxK1> {
  const kh = startKhFake();
  kh.set(NS.acme, { ...nsDefaults(NS.acme, CS.acme), projects: [PROJ.a, PROJ.b, PROJ.shared] });
  kh.set(NS.beta, { ...nsDefaults(NS.beta, CS.beta), projects: [PROJ.beta] });
  const { sql, ready } = await setupPa();
  if (ready) {
    await seedPf1(sql);
    await seedDefs(sql);
  }
  const k1 = ready && (await hasK1Schema(sql));
  const sec = ready && (await tableExists(sql));
  if (k1 && sec) {
    await seedSecrets(sql);
    if (o.seed === "full") await seedFull(sql, kh);
  }
  const k = await makeKeys();
  const hub = await startHub(k, kh, o);
  const redis = await testRedis();
  const rt = new ScriptRuntime(sql, redis);
  const tok = (r: Role) => sign(k, PA[r]);
  return {
    sql,
    ready,
    k1,
    sec,
    kh,
    hub,
    rt,
    tok,
    call: async (r, method, path, body) => api(hub as never, await tok(r), method, path, body),
    stop: async () => {
      await hub.stop();
      redis.disconnect();
      await kh.close();
      await sql.end();
    },
  };
}

/** `/studio/api/kh…` bởi persona (mặc định P = platform_admin). */
export const studio = (c: CtxK1, method: string, path: string, body?: unknown, r: Role = "P") =>
  c.call(r, method, `/studio/api/kh${path}`, body);

/** `ProcessHandles.khWriteOnce()` (seam test-plan §8 G2): một lượt bộ gửi worklog. Vắng ⇒ đỏ ở expect. */
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
export async function tenantRow(sql: Sql, tenant: string): Promise<Json | undefined> {
  const [r] = await sql`select * from hub.kh_tenants where tenant_id = ${tenant}`;
  return r ? { ...r } : undefined;
}
export const errCode = (r: Res): string | undefined => r.json?.error?.code;
export const errDetails = (r: Res): Json => r.json?.error?.details;
