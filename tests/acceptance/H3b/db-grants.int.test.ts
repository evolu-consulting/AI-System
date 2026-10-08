// HUB-FR-78 · HUB-FR-87 · H3b-R16, R22 · PL2 · K9 · test-plan-cases H3b §2.9 A120–A126 (vế acceptance, độc lập test D1):
// quyền `hub_rw` tối thiểu (INSERT/DELETE agent_grants, UPDATE đúng cột hub_config_version, SELECT/INSERT audit_log),
// audit_log append-only (cả owner), CHECK, cột agent_grants không đổi, migration chạy lại + `usage_logs_run_idx`.
// Xanh trước code chấp nhận (D1 đã có).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { runHubMigrations } from "@ai/db/migrate-hub";
import postgres from "postgres";
import { HUB_API_URL, OWNER_URL, type Sql, T, USERS } from "../H1/_fixtures";
import { AGT, GRP, setupH3b } from "./_h3b";

let owner: Sql;
let api: Sql;
beforeAll(async () => {
  owner = await setupH3b();
  api = postgres(HUB_API_URL, { max: 2, onnotice: () => {} });
}, 60_000);
afterAll(async () => {
  await api?.end();
  await owner?.end();
});

/** "ok" hoặc SQLSTATE của lỗi. */
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    return String((err as { code?: string }).code ?? (err as Error).message);
  }
}
const auditRow = (o: Record<string, unknown> = {}) => ({
  tenant_id: T.acme,
  actor_id: USERS.tadmin.id,
  actor_username: "tadmin",
  actor_role: "tenant_admin",
  action: "grant",
  entity: "agent_grant",
  entity_id: AGT.hoadon,
  entity_name: "hoadon → ke-toan",
  hub_config_version: 1,
  ...o,
});

describe("A120–A122 · quyền hub_rw [HUB-FR-78 · H3b-R22 · PL2 · K9]", () => {
  it("HUB-FR-78 · A120 · hub_api trên agent_grants: INSERT ok · DELETE ok · UPDATE granted_by 42501 · TRUNCATE 42501 [H3b-R22]", async () => {
    const ins =
      await code(api`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
      values (${AGT.hoadon}, ${T.acme}, 'group', ${GRP.keToan})`);
    const upd = await code(api`update hub.agent_grants set granted_by = ${USERS.tadmin.id}`);
    const del = await code(api`delete from hub.agent_grants where agent_id = ${AGT.hoadon}`);
    const tru = await code(api`truncate hub.agent_grants`);
    expect({ ins, del, upd, tru }).toEqual({ ins: "ok", del: "ok", upd: "42501", tru: "42501" });
  });

  it("HUB-FR-78 · A121 · hub_api trên config_meta: UPDATE hub_config_version ok · UPDATE từng cột khác 42501 · INSERT 42501 · DELETE 42501 · SELECT FOR UPDATE ok [H3b-R08, R22 · PL2]", async () => {
    const cols = await owner<
      { c: string }[]
    >`select column_name as c from information_schema.columns
      where table_schema = 'hub' and table_name = 'config_meta' and column_name <> 'hub_config_version'`;
    expect(cols.length).toBeGreaterThan(0);
    const other: Record<string, string> = {};
    for (const { c } of cols)
      other[c] = await code(api.unsafe(`update hub.config_meta set "${c}" = "${c}" where id = 1`));
    const got = {
      version: await code(
        api`update hub.config_meta set hub_config_version = hub_config_version where id = 1`,
      ),
      other,
      insert: await code(api`insert into hub.config_meta (id, hub_config_version) values (2, 0)`),
      delete: await code(api`delete from hub.config_meta where id = 1`),
      forUpdate: await code(
        api.begin(
          (tx) => tx`select hub_config_version from hub.config_meta where id = 1 for update`,
        ),
      ),
    };
    expect(got).toEqual({
      version: "ok",
      other: Object.fromEntries(cols.map(({ c }) => [c, "42501"])),
      insert: "42501",
      delete: "42501",
      forUpdate: "ok",
    });
  });

  it("HUB-FR-78 · A122 · danh sách trắng quyền (G11): agent_grants {S,I,D}; config_meta {S} + UPDATE chỉ hub_config_version; audit_log {S,I}; agent_entitlements {I} + UPDATE chỉ revoked_at/granted_by/granted_at (CR-054); sau H4a D1: agents/agent_workflows {S,I,U,D}, orchestrator_settings {I,U,D} + USAGE sequence; admin_rw/agent_runtime không quyền audit_log; admin_rw chỉ SELECT agent_grants [H3b-R22 · PL2]", async () => {
    const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"];
    const has = async (role: string, table: string) => {
      const out: string[] = [];
      for (const p of PRIVS) {
        const [r] = await owner<
          { ok: boolean }[]
        >`select has_table_privilege(${role}, ${table}, ${p}) as ok`;
        if (r?.ok) out.push(p);
      }
      return out;
    };
    const col = async (c: string) => {
      const [r] = await owner<
        { ok: boolean }[]
      >`select has_column_privilege('hub_rw', 'hub.config_meta', ${c}, 'UPDATE') as ok`;
      return r?.ok;
    };
    const writes = (l: string[]) => l.filter((p) => p !== "SELECT");
    expect({
      grants: await has("hub_rw", "hub.agent_grants"),
      meta: await has("hub_rw", "hub.config_meta"),
      metaVersion: await col("hub_config_version"),
      metaId: await col("id"),
      audit: await has("hub_rw", "hub.audit_log"),
      // CR-054: platform_admin bật/tắt agent cho công ty qua hub_rw — thêm/khôi phục/thu hồi, không đổi agent/tenant.
      ent: writes(await has("hub_rw", "hub.agent_entitlements")),
      entCols: await Promise.all(
        ["revoked_at", "granted_by", "granted_at", "agent_id", "tenant_id"].map(
          async (c) =>
            (
              await owner<
                { ok: boolean }[]
              >`select has_column_privilege('hub_rw', 'hub.agent_entitlements', ${c}, 'UPDATE') as ok`
            )[0]?.ok,
        ),
      ),
      // H4a D1 (0010, Gate H4a §2; spec H4a §10 B1): Studio ghi agents/agent_workflows/orchestrator_settings qua hub_rw.
      agents: await has("hub_rw", "hub.agents"),
      workflows: await has("hub_rw", "hub.agent_workflows"),
      orch: writes(await has("hub_rw", "hub.orchestrator_settings")),
      orchSeq: (
        await owner<
          { ok: boolean }[]
        >`select has_sequence_privilege('hub_rw', 'hub.orchestrator_settings_id_seq', 'USAGE') as ok`
      )[0]?.ok,
      adminAudit: await has("admin_rw", "hub.audit_log"),
      rtAudit: await has("agent_runtime", "hub.audit_log"),
      adminGrants: await has("admin_rw", "hub.agent_grants"),
    }).toEqual({
      grants: ["SELECT", "INSERT", "DELETE"],
      meta: ["SELECT"],
      metaVersion: true,
      metaId: false,
      audit: ["SELECT", "INSERT"],
      ent: ["INSERT"],
      entCols: [true, true, true, false, false],
      agents: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      workflows: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      orch: ["INSERT", "UPDATE", "DELETE"],
      orchSeq: true,
      adminAudit: [],
      rtAudit: [],
      adminGrants: ["SELECT"],
    });
  });
});

describe("A123–A126 · audit_log, cột, migration [HUB-FR-87 · H3b-R16, R22]", () => {
  it("HUB-FR-87 · A124 · CHECK action/entity/actor_role 'x', entity_name 201 ký tự ⇒ 23514; hub_api INSERT hợp lệ ⇒ ok, seq tự sinh [H3b-R16]", async () => {
    const bad = [
      auditRow({ action: "x" }),
      auditRow({ entity: "x" }),
      auditRow({ actor_role: "x" }),
      auditRow({ entity_name: "n".repeat(201) }),
    ];
    const got = [];
    for (const r of bad) got.push(await code(api`insert into hub.audit_log ${api(r)}`));
    expect(got).toEqual(["23514", "23514", "23514", "23514"]);
    const [row] = await api<
      { seq: string }[]
    >`insert into hub.audit_log ${api(auditRow())} returning seq`;
    expect(Number(row?.seq)).toBeGreaterThan(0);
  });

  it("HUB-FR-87 · A123 · audit_log UPDATE/DELETE/TRUNCATE: hub_api ⇒ 42501 · owner ⇒ P0001 (append-only) [H3b-R16]", async () => {
    await api`insert into hub.audit_log ${api(auditRow())}`;
    const asApi = [
      await code(api`update hub.audit_log set entity_name = 'y'`),
      await code(api`delete from hub.audit_log`),
      await code(api`truncate hub.audit_log`),
    ];
    const asOwner = [
      await code(owner`update hub.audit_log set entity_name = 'y'`),
      await code(owner`delete from hub.audit_log`),
      await code(owner`truncate hub.audit_log`),
    ];
    expect({ asApi, asOwner }).toEqual({
      asApi: ["42501", "42501", "42501"],
      asOwner: ["P0001", "P0001", "P0001"],
    });
  });

  it("HUB-FR-78 · A125 · cột hub.agent_grants ≡ danh sách 0000 (R22: không đổi bảng) [H3b-R22]", async () => {
    const cols = await owner<
      { c: string }[]
    >`select column_name as c from information_schema.columns
      where table_schema = 'hub' and table_name = 'agent_grants' order by ordinal_position`;
    expect(cols.map((r) => r.c)).toEqual([
      "id",
      "agent_id",
      "tenant_id",
      "subject_type",
      "subject_id",
      "granted_by",
      "granted_at",
    ]);
  });

  it("HUB-FR-52 · A126 · chạy lại migration Hub ⇒ không lỗi; usage_logs_run_idx có [H3b-R22]", async () => {
    expect(await code(runHubMigrations({ url: OWNER_URL, appEnv: "test" }))).toBe("ok");
    const [r] = await owner<{ n: number }[]>`select count(*)::int as n from pg_indexes
      where schemaname = 'hub' and indexname = 'usage_logs_run_idx'`;
    expect(r?.n).toBe(1);
  });
});
