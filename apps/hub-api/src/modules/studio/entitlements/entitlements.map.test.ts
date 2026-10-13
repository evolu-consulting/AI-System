// HUB-FR-78 · spec H4b2 §3 C · plan §2.4 · `toMatrix`/`toCellDetail` thuần; đầu ra parse được bằng schema contract.
import { describe, expect, it } from "bun:test";
import { EntitlementCellDetailSchema, EntitlementMatrixSchema } from "@ai/contracts/studio";
import { toCellDetail, toMatrix } from "./entitlements.map";

const u = (n: number) => `a4b20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A1 = u(1);
const A2 = u(2);
const T1 = u(11);
const T2 = u(12);
const D = new Date("2026-10-01T00:00:00.000Z");
const agent = (id: string, key: string, over = {}) => ({
  id,
  key,
  name: { vi: `Tên ${key}`, en: key },
  enabled: true,
  is_orch: false,
  only_tenant_id: null,
  ...over,
});
const tenant = (id: string, key: string) => ({ id, key, name: key.toUpperCase(), active: true });

describe("toMatrix", () => {
  it("gom grant theo loại, thiếu ⇒ 0; chỉ ô thuộc agents × tenants đã trả; name = vi", () => {
    const m = toMatrix({
      agents: [agent(A1, "a1"), agent(A2, "a2", { is_orch: true, only_tenant_id: T1 })],
      tenants: [tenant(T1, "t1"), tenant(T2, "t2")],
      ents: [
        { agent_id: A1, tenant_id: T1, granted_at: D },
        { agent_id: A2, tenant_id: T2, granted_at: D.toISOString() },
        { agent_id: u(99), tenant_id: T1, granted_at: D },
      ],
      grantCounts: [
        { agent_id: A1, tenant_id: T1, subject_type: "group", n: 2 },
        { agent_id: A1, tenant_id: T1, subject_type: "user", n: 1 },
      ],
      version: 7,
    });
    expect(EntitlementMatrixSchema.parse(m)).toEqual(m);
    expect(m.agents[0]?.name).toBe("Tên a1");
    expect(m.agents[1]).toMatchObject({ is_orchestrator: true, only_tenant_id: T1 });
    expect(m.cells).toEqual([
      {
        agent_id: A1,
        tenant_id: T1,
        granted_at: D.toISOString(),
        grant_count: 3,
        grants: { group: 2, user: 1, tenant: 0 },
      },
      {
        agent_id: A2,
        tenant_id: T2,
        granted_at: D.toISOString(),
        grant_count: 0,
        grants: { group: 0, user: 0, tenant: 0 },
      },
    ]);
    expect(m).toMatchObject({ truncated: false, hub_config_version: 7 });
  });
});

describe("toMatrix · cắt", () => {
  it("agent không phải Orchestrator ⇒ only_tenant_id null; vượt limit ⇒ cắt + truncated", () => {
    const m = toMatrix(
      {
        agents: [agent(A1, "a1", { only_tenant_id: T1 }), agent(A2, "a2")],
        tenants: [tenant(T1, "t1")],
        ents: [{ agent_id: A2, tenant_id: T1, granted_at: D }],
        grantCounts: [],
        version: 0,
      },
      1,
    );
    expect(m.agents.map((a) => [a.id, a.only_tenant_id])).toEqual([[A1, null]]);
    expect(m.cells).toEqual([]);
    expect(m.truncated).toBe(true);
  });
});

const base = { agent: { id: A1, key: "a1", name: { vi: "Một" } }, tenant: tenant(T1, "t1") };
const grant = (n: number, over = {}) => ({
  id: u(100 + n),
  subject_type: "group" as const,
  subject_id: u(200 + n),
  granted_at: D,
  granted_by_username: "padmin",
  group_name: { vi: "Kế toán" },
  user_name: null,
  tenant_name: null,
  ...over,
});

describe("toCellDetail · đọc", () => {
  it("chưa có hàng ⇒ entitled false, mốc null", () => {
    const d = toCellDetail({ ...base, ent: undefined, grants: [] });
    expect(EntitlementCellDetailSchema.parse(d)).toEqual(d);
    expect(d).toMatchObject({
      entitled: false,
      granted_at: null,
      granted_by: null,
      revoked_at: null,
    });
  });

  it("đã thu hồi ⇒ entitled false, revoked_at; grant vẫn hiện; tên subject theo loại, vắng ⇒ id", () => {
    const d = toCellDetail({
      ...base,
      ent: { granted_at: D, revoked_at: D, granted_by: u(5), granted_by_username: "padmin" },
      grants: [
        grant(1),
        grant(2, { subject_type: "user", group_name: null, user_name: "Lan" }),
        grant(3, { subject_type: "tenant", group_name: null, tenant_name: "Acme" }),
        grant(4, { group_name: null }),
      ],
    });
    expect(EntitlementCellDetailSchema.parse(d)).toEqual(d);
    expect(d).toMatchObject({
      entitled: false,
      revoked_at: D.toISOString(),
      granted_by: { id: u(5), username: "padmin" },
    });
    expect(d.grants.map((g) => g.subject.name)).toEqual(["Kế toán", "Lan", "Acme", u(204)]);
  });
});

describe("toCellDetail · cắt", () => {
  it("đang cấp ⇒ entitled true; người cấp vắng tên ⇒ granted_by null; vượt limit ⇒ grants_truncated", () => {
    const d = toCellDetail(
      {
        ...base,
        ent: { granted_at: D, revoked_at: null, granted_by: u(5), granted_by_username: null },
        grants: [grant(1), grant(2)],
      },
      1,
    );
    expect(d).toMatchObject({ entitled: true, granted_by: null, grants_truncated: true });
    expect(d.grants).toHaveLength(1);
  });
});
