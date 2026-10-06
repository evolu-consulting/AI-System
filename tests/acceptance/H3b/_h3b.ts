// HUB-FR-78 · HUB-FR-79 · HUB-FR-52 · HUB-FR-87 · ADM-FR-37 · hạ tầng int H3b (test-plan H3b §2, §2.1): DB sạch + fixture
// H1 (tenant/user) + cấu hình Hub H1 (provider, profile, Orchestrator mặc định) rồi THAY quyền agent bằng bộ H3b
// (`hoadon`, `khodu`, `tatt`, `cli-x`, `cu`, `chua`, Orchestrator tenant `acme`/`beta`, group `ke-toan`/`kho`/`ban-hang`,
// user `badmin`). Hub thật (`startHubX` H1) + `hubAudit` tiêm lỗi (N7, P12). Không chứa `it(...)`.
// Audit append-only ⇒ không dọn: đếm theo `seq > mốc`. NOTIFY "không xảy ra" ⇒ sentinel kênh riêng (cùng kết nối LISTEN,
// giao theo thứ tự commit).
import { expect } from "bun:test";
import { HUB_CONFIG_CHANNEL } from "@ai/contracts/hub";
import { ErrorResponseSchema } from "@ai/contracts/hub-admin";
import postgres from "postgres";
import {
  call,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  OWNER_URL,
  ownerSql,
  prepareDb,
  type Res,
  type Sql,
  sign,
  T,
  USERS,
  type UserKey,
  waitFor,
} from "../H1/_fixtures";
import {
  AG,
  type HubExtra,
  type HubX,
  hubConfigChange,
  insertHubConfig,
  PROFILE,
  startHubX,
} from "../H1/_hub";

// ---------- id cố định (dải `a3b0…`) ----------
const h = (n: number) => `a3b00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Bộ sinh uuid tất định cho dữ liệu tạo trong ca (mỗi file một dải `base` ≥ 1000). */
export function idGen3(base: number): () => string {
  let n = base;
  return () => h(n++);
}
/** Agent H3b. `hoadon` = agent H1 (entitlement đổi sang `acme`); `orch` = Orchestrator mặc định H1. */
export const AGT = {
  hoadon: AG.hoadon,
  khodu: h(1),
  tatt: h(2),
  cliX: h(3),
  cu: h(4),
  chua: h(5),
  orch: AG.orchestrator,
  orchAcme: h(6),
  orchBeta: h(7),
} as const;
export const GRP = { keToan: h(11), kho: h(12), banHang: h(13) } as const;
export { T, USERS };

type Row = (typeof USERS)[UserKey];
/** tenant_admin của `beta` (thêm bằng owner). */
export const BADMIN: Row = {
  id: h(21),
  tid: T.beta,
  username: "badmin",
  role: "tenant_admin",
  locale: "vi",
  active: true,
  locked: false,
};
export type Who = UserKey | "badmin";
export const userOf = (w: Who): Row => (w === "badmin" ? BADMIN : USERS[w]);
/** uuid không tồn tại (khác `UNKNOWN` H1 để không trùng tài nguyên nào). */
export const NONE = h(999);

// ---------- dữ liệu ----------
async function insertAgents(sql: Sql): Promise<void> {
  const agent = (id: string, key: string, runtime = "agentic-cli", enabled = true) => ({
    id,
    key,
    name: sql.json({ vi: `Tên ${key}`, en: `Name ${key}` }),
    description: `Agent ${key} dùng cho kiểm thử cấp quyền H3b.`,
    runtime,
    profile_id: PROFILE.fake,
    system_prompt: "",
    enabled,
  });
  await sql`insert into hub.agents ${sql([
    agent(AGT.khodu, "khodu"),
    agent(AGT.tatt, "tatt", "agentic-cli", false),
    agent(AGT.cliX, "cli-x", "llm"),
    agent(AGT.cu, "cu"),
    agent(AGT.chua, "chua"),
    agent(AGT.orchAcme, "orch-acme"),
    agent(AGT.orchBeta, "orch-beta"),
  ])}`;
  await sql`insert into hub.orchestrator_settings (tenant_id, agent_id, max_steps, token_budget, history_n)
    values (${T.acme}, ${AGT.orchAcme}, 5, 200000, 10), (${T.beta}, ${AGT.orchBeta}, 5, 200000, 10)`;
  const ent = [AGT.hoadon, AGT.tatt, AGT.cliX, AGT.cu, AGT.orch, AGT.orchAcme, AGT.orchBeta].map(
    (agent_id) => ({ agent_id, tenant_id: T.acme }),
  );
  ent.push({ agent_id: AGT.khodu, tenant_id: T.beta });
  await sql`insert into hub.agent_entitlements ${sql(ent)}`;
  await sql`update hub.agent_entitlements set revoked_at = now()
    where agent_id = ${AGT.cu} and tenant_id = ${T.acme}`;
}

async function insertGroups(sql: Sql): Promise<void> {
  await sql`insert into admin.groups (id, tenant_id, key, name) values
    (${GRP.keToan}, ${T.acme}, 'ke-toan', ${sql.json({ vi: "Kế toán", en: "Accounting" })}),
    (${GRP.kho}, ${T.acme}, 'kho', ${sql.json({ vi: "Kho" })}),
    (${GRP.banHang}, ${T.beta}, 'ban-hang', ${sql.json({ vi: "Bán hàng" })})`;
  await sql`insert into admin.group_members (tenant_id, group_id, user_id) values
    (${T.acme}, ${GRP.keToan}, ${USERS.lan.id}), (${T.acme}, ${GRP.keToan}, ${USERS.hoa.id}),
    (${T.acme}, ${GRP.kho}, ${USERS.tam.id}), (${T.beta}, ${GRP.banHang}, ${USERS.an.id})`;
}

/** DB sạch + fixture H1 + cấu hình Hub H1, bỏ mọi entitlement/grant H1, thay bằng bộ H3b (§2.1); 0 grant. */
export async function setupH3b(): Promise<Sql> {
  await prepareDb();
  const sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  await sql`delete from hub.agent_grants`;
  await sql`delete from hub.agent_entitlements`;
  const b = BADMIN;
  await sql`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role, locale,
      active, locked_by_tenant, must_change_password)
    values (${b.id}, ${b.tid}, ${b.username}, 'badmin@example.test', 'x', 'B Admin', ${b.role}, 'vi', true, false,
      false)`;
  await insertAgents(sql);
  await insertGroups(sql);
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  return sql;
}

// ---------- hub-api thật + `hubAudit` (N7) ----------
/** Hàng audit Hub tối thiểu test cần đọc (đủ để tiêm lỗi theo `action`); kiểu thật ở B1 `lib/hub-audit.ts`. */
export type AuditRowLike = { action?: unknown } & Record<string, unknown>;
export type HubAuditLike = { insert: (tx: unknown, row: AuditRowLike) => Promise<void> };
/** Seam P12: `AppDeps.hubAudit?` (B1). `startHubX` trải `...extra` vào deps nên field đi thẳng tới `createApp`. */
export type H3bExtra = Omit<HubExtra, "signal"> & { hubAudit?: HubAuditLike };

export function startHubH3b(k: Keys, extra: H3bExtra = {}): Promise<HubX> {
  const deps: H3bExtra = { instanceId: "qc-hub-h3b", jobMaxWaitS: 30, ...extra };
  return startHubX(k, deps);
}

/** `HubAuditWriter` ném khi `action ∈ actions` (AC-04, AC-11). Mọi action khác cũng ném (khác thông điệp): ca dùng
 *  writer này chỉ có audit thuộc `actions`; `calls` ghi lại action đã gọi. */
export function failingAudit(actions: readonly string[]): HubAuditLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    insert: async (_tx, row) => {
      const a = String(row?.action);
      calls.push(a);
      throw new Error(
        actions.includes(a) ? `qc: audit ${a} lỗi tiêm` : `qc: audit ${a} không mong đợi`,
      );
    },
  };
}

export type Ctx = { sql: Sql; k: Keys; hub: HubX; stop: () => Promise<void> };
export async function startH3b(extra: H3bExtra = {}): Promise<Ctx> {
  const sql = await setupH3b();
  const k = await makeKeys();
  const hub = await startHubH3b(k, extra);
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
export const tok = (k: Keys, w: Who): Promise<string> => sign(k, userOf(w));
export function qs(p: Record<string, string | undefined>): string {
  const e = Object.entries(p).filter((x): x is [string, string] => x[1] !== undefined);
  return e.length ? `?${new URLSearchParams(e).toString()}` : "";
}
export type GrantRef = { agent: string; type: "group" | "user"; subject: string };
export const body = (g: GrantRef) => ({
  agent_id: g.agent,
  subject_type: g.type,
  subject_id: g.subject,
});

export async function postGrant(x: Ctx, w: Who, g: GrantRef, tenant?: string, hub = x.hub) {
  return call(hub, "POST", `/agent-grants${qs({ tenant_id: tenant })}`, {
    token: await tok(x.k, w),
    body: body(g),
  });
}
export async function delGrant(x: Ctx, w: Who, g: GrantRef, tenant?: string, hub = x.hub) {
  const p = qs({ tenant_id: tenant, ...body(g) });
  return call(hub, "DELETE", `/agent-grants${p}`, { token: await tok(x.k, w) });
}
export async function listGrants(x: Ctx, w: Who, p: Record<string, string | undefined> = {}) {
  return call(x.hub, "GET", `/agent-grants${qs(p)}`, { token: await tok(x.k, w) });
}
export async function effectiveOf(x: Ctx, w: Who, userId: string, tenant?: string) {
  const path = `/agent-grants/effective/${userId}${qs({ tenant_id: tenant })}`;
  return call(x.hub, "GET", path, { token: await tok(x.k, w) });
}
export async function traceOf(x: Ctx, w: Who, runId: string) {
  return call(x.hub, "GET", `/runs/${runId}/trace`, { token: await tok(x.k, w) });
}

/** `{status, code, details}` theo `ErrorResponseSchema`; `code` undefined nếu thân không đúng contract lỗi. */
export function errOf(res: Res): { status: number; code: string | undefined; details: Json } {
  const p = ErrorResponseSchema.safeParse(res.json);
  return {
    status: res.status,
    code: p.success ? p.data.error.code : undefined,
    details: res.json?.error?.details,
  };
}
export const e = (status: number, code: string, details?: Json) =>
  details === undefined ? { status, code, details: undefined } : { status, code, details };

/** G1: 404 "giống hệt" = cùng status + content-type + thân (bỏ `request_id` nếu có). */
export function expectSame404(a: Res, b: Res): void {
  const norm = (r: Res) => {
    const j = r.json && typeof r.json === "object" ? structuredClone(r.json) : r.json;
    if (j?.error) delete j.error.request_id;
    if (j) delete j.request_id;
    return { status: r.status, ct: r.headers.get("content-type"), body: j };
  };
  expect(norm(a)).toEqual(norm(b));
  expect(a.status).toBe(404);
  expect(errOf(a).code).toBe("NOT_FOUND");
}

// ---------- trạng thái ----------
export type State = { grants: Json[]; version: number; audit: number };
/** Grant mọi tenant (id + khoá) + `hub_config_version` + audit max seq. "0 ghi" = `stateOf` trước ≡ sau. */
export async function stateOf(sql: Sql): Promise<State> {
  const grants =
    await sql`select id, tenant_id, agent_id, subject_type, subject_id from hub.agent_grants
    order by tenant_id, agent_id, subject_type, subject_id`;
  return {
    grants: grants.map((r) => ({ ...r })),
    version: await versionOf(sql),
    audit: await auditMax(sql),
  };
}
export async function versionOf(sql: Sql): Promise<number> {
  const [r] = await sql<
    { v: number }[]
  >`select hub_config_version as v from hub.config_meta where id = 1`;
  return r?.v ?? -1;
}
export async function auditMax(sql: Sql): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select coalesce(max(seq), 0)::int as n from hub.audit_log`;
  return r?.n ?? 0;
}
/** Hàng audit có `seq > from` (sắp `seq`), lọc tuỳ chọn. */
export async function auditSince(
  sql: Sql,
  from: number,
  f: { entityId?: string; action?: string } = {},
): Promise<Json[]> {
  const rows = await sql`select * from hub.audit_log where seq > ${from}
    and (${f.entityId ?? null}::uuid is null or entity_id = ${f.entityId ?? null}::uuid)
    and (${f.action ?? null}::text is null or action = ${f.action ?? null}::text) order by seq`;
  return rows.map((r) => ({ ...r }));
}
export async function grantRow(sql: Sql, tenant: string, g: GrantRef): Promise<Json | undefined> {
  const [r] =
    await sql`select * from hub.agent_grants where tenant_id = ${tenant} and agent_id = ${g.agent}
    and subject_type = ${g.type} and subject_id = ${g.subject}`;
  return r ? { ...r } : undefined;
}
/** Grant bằng owner (không bump, không NOTIFY) — dữ liệu dựng sẵn. */
export async function insertGrant(sql: Sql, tenant: string, g: GrantRef, by: string | null = null) {
  await sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id, granted_by)
    values (${g.agent}, ${tenant}, ${g.type}, ${g.subject}, ${by}) on conflict do nothing`;
}
export const clearGrants = async (sql: Sql) => {
  await sql`delete from hub.agent_grants`;
};

/** Entitlement như seed (bump + NOTIFY). */
export const entitle = (sql: Sql, agent: string, tenant: string) =>
  hubConfigChange(
    sql,
    (tx) => tx`insert into hub.agent_entitlements (agent_id, tenant_id) values (${agent}, ${tenant})
      on conflict (agent_id, tenant_id) do update set revoked_at = null`,
  );
export const revokeEnt = (sql: Sql, agent: string, tenant: string) =>
  hubConfigChange(
    sql,
    (tx) => tx`update hub.agent_entitlements set revoked_at = now()
      where agent_id = ${agent} and tenant_id = ${tenant}`,
  );

// ---------- NOTIFY ----------
const SENTINEL_CH = "qc_h3b_sentinel";
export type Notes = {
  mark: () => number;
  /** Thông điệp `hub_config_changed` (đã parse) từ mốc. */
  since: (m: number) => Json[];
  /** Phát sentinel kênh riêng rồi chờ tới (≤ 3 s): mọi NOTIFY commit trước đó đã tới. */
  sentinel: () => Promise<void>;
  /** Thời điểm (ms epoch) nhận thông điệp thứ `i` (theo `since`). */
  at: (m: number) => number[];
  close: () => Promise<void>;
};
export async function listenHub(): Promise<Notes> {
  const l = postgres(OWNER_URL, { max: 2, onnotice: () => {} });
  const all: { ch: string; p: Json; t: number }[] = [];
  const push = (ch: string) => (raw: string) => {
    let p: Json;
    try {
      p = JSON.parse(raw);
    } catch {
      p = raw;
    }
    all.push({ ch, p, t: Date.now() });
  };
  await l.listen(HUB_CONFIG_CHANNEL, push(HUB_CONFIG_CHANNEL));
  await l.listen(SENTINEL_CH, push(SENTINEL_CH));
  let n = 0;
  const hubMsgs = (m: number) => all.slice(m).filter((x) => x.ch === HUB_CONFIG_CHANNEL);
  return {
    mark: () => all.length,
    since: (m) => hubMsgs(m).map((x) => x.p),
    at: (m) => hubMsgs(m).map((x) => x.t),
    sentinel: async () => {
      const id = `s${++n}`;
      await l.notify(SENTINEL_CH, id);
      const hit = await waitFor(
        async () => all.some((x) => x.ch === SENTINEL_CH && x.p === id),
        (v) => v,
        3_000,
      );
      expect({ sentinel: hit }).toEqual({ sentinel: true });
    },
    close: () => l.end(),
  };
}

/** "0 ghi": không NOTIFY từ mốc `m` (sentinel) + `stateOf` ≡ `s0` (grant cả hai tenant, version, audit). */
export async function expectNoWrite(sql: Sql, n: Notes, m: number, s0: State): Promise<void> {
  await n.sentinel();
  expect(n.since(m)).toEqual([]);
  expect(await stateOf(sql)).toEqual(s0);
}

// ---------- khoá (AC-05) ----------
/** Owner giữ `FOR UPDATE` hàng `config_meta` trên kết nối riêng; trả hàm nhả (commit). */
export async function holdConfigMeta(sql: Sql): Promise<() => Promise<void>> {
  const r = await sql.reserve();
  await r`begin`;
  await r`select hub_config_version from hub.config_meta where id = 1 for update`;
  return async () => {
    await r`commit`;
    r.release();
  };
}
/** Số backend `hub_api` đang chờ khoá trong DB này. */
export async function lockWaiters(sql: Sql): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from pg_stat_activity
    where datname = current_database() and usename = 'hub_api' and wait_event_type = 'Lock'`;
  return r?.n ?? 0;
}
