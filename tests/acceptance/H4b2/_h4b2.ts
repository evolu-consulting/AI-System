// HUB-FR-66 · HUB-FR-67 · HUB-FR-78 · hạ tầng int H4b-2 (test-plan H4b2 §2): DB sạch H3b (acme/beta/platform, agent
// hoadon/khodu/tatt/cli-x/cu/chua/orch, group ke-toan/kho, `tadmin` acme, `badmin` beta) + provider `fake-cli`/`claude-sub`
// (subscription) + profile `fake-1`/`claude-sub-1` (H1) + secret H4b-1 (bản mã đối chứng `specSeal`) + provider `dify`
// (readonly, như seed) rồi hub-api thật với seam `hubSecretsKey` (H4b-1) + `fetch`/`sleep` tiêm (plan H4b2 §4).
// Không import module chưa có ⇒ `bun run typecheck` xanh trước code. Không chứa `it(...)`.
import { expect } from "bun:test";
import { call, type Json, makeKeys, R, type Res, type Sql, T, USERS } from "../H1/_fixtures";
import { hubConfigChange } from "../H1/_hub";
import {
  AGT,
  auditMax,
  auditSince,
  errOf,
  GRP,
  setupH3b,
  startHubH3b,
  tok,
  versionOf,
  type Who,
} from "../H3b/_h3b";
import {
  type Ctx,
  captureAll,
  HUB_KEY,
  type LogCap,
  OTHER_KEY,
  seedSecret,
  specSeal,
} from "../H4b1/_h4b1";

export {
  AGT,
  auditMax,
  auditSince,
  type Ctx,
  captureAll,
  errOf,
  GRP,
  hubConfigChange,
  type Json,
  type LogCap,
  R,
  type Res,
  type Sql,
  T,
  USERS,
  versionOf,
  type Who,
};

// ---------- id cố định (dải `a4b2…`) ----------
const h = (n: number) => `a4b20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Bộ sinh uuid tất định (mỗi file một dải `base` ≥ 1000). */
export function idGen(base: number): () => string {
  let n = base;
  return () => h(n++);
}
export const NONE = h(999);

/** Giá trị secret dễ nhận khi rò (plan §5: `fake-ok-…` hợp lệ với vendor `fake`). */
export const KEY = {
  ok: "fake-ok-qc-H4B2-7f3a9c1e5b2d",
  bad: "fake-bad-qc-H4B2-2d8e4a6c0f9a",
  openai: "sk-qc-H4B2-openai-Zx9Pq7Lm4N8r",
  anth: "sk-ant-qc-H4B2-anth-Qw3Er5Ty7U",
  google: "AIzaQcH4B2googleKey_Mn0Bv2Cx4",
  kh: "kh-qc-H4B2-value-Lp0Ok9Ij8U",
  broken: "fake-ok-qc-H4B2-broken-Hg5Fd3Sa",
} as const;
export const ALL_KEYS: readonly string[] = Object.values(KEY);
/** Secret dựng sẵn bằng owner. `broken` = bản mã bằng khoá khác ⇒ `useSecret` decrypt_failed. */
export const SEC = {
  ok: h(1),
  bad: h(2),
  openai: h(3),
  anth: h(4),
  google: h(5),
  kh: h(6),
  broken: h(7),
} as const;
export const SEC_NAME: Record<keyof typeof SEC, string> = {
  ok: "qc-fake-ok",
  bad: "qc-fake-bad",
  openai: "qc-openai",
  anth: "qc-anth",
  google: "qc-google",
  kh: "qc-kh",
  broken: "qc-broken",
};
/** Provider `dify` (readonly, D11) — seed quản. */
export const DIFY = { id: h(20), key: "dify" } as const;

async function seedAll(sql: Sql): Promise<void> {
  for (const k of ["ok", "bad", "openai", "anth", "google"] as const)
    await seedSecret(sql, {
      id: SEC[k],
      kind: "provider_api_key",
      tenantId: null,
      name: SEC_NAME[k],
      value: KEY[k],
    });
  await seedSecret(sql, {
    id: SEC.kh,
    kind: "kh_api_key",
    tenantId: null,
    name: SEC_NAME.kh,
    value: KEY.kh,
  });
  const m = { id: SEC.broken, kind: "provider_api_key", tenantId: null };
  const s = specSeal(KEY.broken, m, 1, OTHER_KEY);
  await sql`insert into hub.secrets (id, kind, tenant_id, name, ciphertext, iv, key_version)
    values (${SEC.broken}, 'provider_api_key', null, ${SEC_NAME.broken}, ${s.ciphertext}, ${s.iv}, 1)`;
  await sql`insert into hub.providers (id, key, kind, vendor, max_concurrency, enabled, dev_only)
    values (${DIFY.id}, ${DIFY.key}, 'api', 'dify', 1, true, false)`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

// ---------- hub-api thật ----------
/** Một lần gọi `fetch` của Hub (plan §3.2: `deps.fetch(url, {headers, redirect, signal})`). */
export type FetchCall = { url: string; headers: Record<string, string>; redirect?: string };
export type FetchStub = typeof fetch & { calls: FetchCall[] };
/** `fetch` giả: ghi lại lời gọi, trả `respond(call)` (ném ⇒ mô phỏng timeout/network). */
export function stubFetch(respond: (c: FetchCall) => Response | Promise<Response>): FetchStub {
  const calls: FetchCall[] = [];
  const f = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String((input as Request)?.url ?? input);
    const hd = new Headers(init?.headers ?? (input as Request)?.headers);
    const c: FetchCall = {
      url,
      headers: Object.fromEntries([...hd.entries()].map(([k, v]) => [k.toLowerCase(), v])),
      redirect: init?.redirect,
    };
    calls.push(c);
    return respond(c);
  }) as unknown as FetchStub;
  f.calls = calls;
  return f;
}
export type H4b2Extra = {
  instanceId?: string;
  hubSecretsKey?: typeof HUB_KEY | null;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};
export async function startH4b2(extra: H4b2Extra = {}): Promise<Ctx> {
  const sql = await setupH3b();
  await seedAll(sql);
  const k = await makeKeys();
  const hub = await startHubH3b(k, {
    instanceId: "qc-hub-h4b2",
    hubSecretsKey: HUB_KEY,
    ...extra,
  } as never);
  return {
    sql,
    k,
    hub,
    stop: async () => {
      await hub.stop();
      await sql.end();
    },
  };
}

// ---------- gọi API ----------
/** `method /studio/api{path}` với token của `w` (null = không token). */
export async function st(
  x: Ctx,
  w: Who | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Res> {
  const token = w ? await tok(x.k, w) : undefined;
  return call(x.hub, method, `/studio/api${path}`, { token, body });
}
export const pa = (x: Ctx, method: string, path: string, body?: unknown) =>
  st(x, "padmin", method, path, body);

/** Body `ProviderCreate` loại `api` (mặc định vendor `fake`, secret `qc-fake-ok`). */
export const apiBody = (key: string, o: Json = {}): Json => ({
  key,
  kind: "api",
  vendor: "fake",
  base_url: null,
  secret_id: SEC.ok,
  max_concurrency: 1,
  enabled: true,
  ...o,
});
/** Body `ProviderCreate` loại `subscription`. */
export const subBody = (key: string, o: Json = {}): Json => ({
  key,
  kind: "subscription",
  vendor: "anthropic",
  base_url: null,
  secret_id: null,
  max_concurrency: 2,
  enabled: true,
  ...o,
});
/** Body `ProviderUpdate` từ chi tiết hiện tại (chỉ trường sửa được). */
export const putBody = (d: Json, o: Json = {}): Json => ({
  version: d.version,
  base_url: d.base_url ?? null,
  secret_id: d.secret?.id ?? null,
  max_concurrency: d.max_concurrency,
  enabled: d.enabled,
  ...o,
});
export const step = (provider_key: string, on: string[] = [], model: string | null = null) => ({
  provider_key,
  model,
  on,
});
export const idOf = (r: Res): string => (r.json?.id && r.status < 300 ? r.json.id : NONE);
/** Tạo provider; khẳng định 201 rồi trả chi tiết. */
export async function mkProvider(x: Ctx, body: Json): Promise<Json> {
  const r = await pa(x, "POST", "/providers", body);
  expect([body.key, r.status]).toEqual([body.key, 201]);
  return r.json;
}
export async function mkProfile(x: Ctx, key: string, steps: Json[]): Promise<Json> {
  const r = await pa(x, "POST", "/model-profiles", { key, steps });
  expect([key, r.status]).toEqual([key, 201]);
  return r.json;
}
/** Đường dẫn VALIDATION_ERROR (`details.issues[].path` nối bằng "."). */
export function pathsOf(r: Res): string[] {
  const issues = errOf(r).details?.issues ?? [];
  return issues.map((i: { path: unknown }) =>
    Array.isArray(i.path) ? i.path.join(".") : String(i.path),
  );
}

// ---------- contract (subpath có sẵn; export mới vắng ⇒ đỏ ở expect) ----------
export const loadStudio = async (): Promise<Record<string, Json>> =>
  (await import("@ai/contracts/studio")) as Record<string, Json>;
/** Thân hợp schema `name` của `@ai/contracts/studio`. */
export async function expectSchema(name: string, body: unknown): Promise<void> {
  const c = await loadStudio();
  expect([name, typeof c[name]?.safeParse]).toEqual([name, "function"]);
  const p = c[name].safeParse(body);
  expect(p.success ? "ok" : JSON.stringify(p.error?.issues)).toBe("ok");
}

// ---------- DB (owner) ----------
export async function providerRow(sql: Sql, key: string): Promise<Json | undefined> {
  const [r] = await sql`select * from hub.providers where key = ${key}`;
  return r ? { ...r } : undefined;
}
export async function profileRow(sql: Sql, key: string): Promise<Json | undefined> {
  const [r] = await sql`select * from hub.model_profiles where key = ${key}`;
  return r ? { ...r } : undefined;
}
/** "0 ghi": provider + profile (cột có ở mọi phiên bản) + `hub_config_version` + max audit seq. */
export async function cfgState(sql: Sql): Promise<Json> {
  const p = await sql`select to_jsonb(p) - 'updated_at' as j from hub.providers p order by key`;
  const m =
    await sql`select to_jsonb(m) - 'updated_at' as j from hub.model_profiles m order by key`;
  return {
    providers: p.map((r) => r.j),
    profiles: m.map((r) => r.j),
    version: await versionOf(sql),
    audit: await auditMax(sql),
  };
}
/** Đặt `provider_state` (owner, như Runtime ghi). */
export async function setState(
  sql: Sql,
  key: string,
  o: {
    status: string;
    cooldown?: string | null;
    lastError?: string | null;
    probe?: string | null;
    lastOk?: string | null;
  },
): Promise<void> {
  await sql`insert into hub.provider_state (provider_key, status, cooldown_until, last_error, last_probe_at, last_ok_at)
    values (${key}, ${o.status}, ${o.cooldown ?? null}::timestamptz, ${o.lastError ?? null},
      ${o.probe ?? null}::timestamptz, ${o.lastOk ?? null}::timestamptz)
    on conflict (provider_key) do update set status = excluded.status, cooldown_until = excluded.cooldown_until,
      last_error = excluded.last_error, last_probe_at = excluded.last_probe_at,
      last_ok_at = excluded.last_ok_at`;
}
export const clearState = (sql: Sql, key: string) =>
  sql`delete from hub.provider_state where provider_key = ${key}`;
/** Job gắn provider (run `R.runDone` của lan; `running` chiếm slot, khác ⇒ lịch sử). */
export async function insertJob(sql: Sql, providerKey: string, status = "succeeded") {
  const L = USERS.lan;
  await sql`insert into hub.jobs (tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
      provider_key, payload, status, worker_id, started_at, heartbeat_at, finished_at)
    values (${L.tid}, ${L.id}, ${R.runDone}, ${crypto.randomUUID()}, ${R.conv}, ${AGT.hoadon}, 'agent.cli',
      ${providerKey}, ${sql.json({})}, ${status}, 'qc-worker-h4b2', now(), now(),
      ${status === "running" ? null : new Date()})`;
}
/** Không chuỗi giá trị nào xuất hiện trong `text`. */
export function expectNoKey(text: string, keys: readonly string[] = ALL_KEYS): void {
  expect(keys.filter((v) => text.includes(v))).toEqual([]);
}
/** Mọi chuỗi con ≥ 8 ký tự liền của `key` vắng mặt trong `text`. */
export function expectNoChunk(text: string, key: string): void {
  const hit: string[] = [];
  for (let i = 0; i + 8 <= key.length; i++) {
    const c = key.slice(i, i + 8);
    if (text.includes(c)) hit.push(c);
  }
  expect(hit).toEqual([]);
}
