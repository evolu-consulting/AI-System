// niti-import · luật thuần chế độ MỘT tài khoản: lọc theo chủ (HĐ + phụ lục + sổ + đánh giá tự do + công ty + nhắc), chia đơn vị
// ghi theo HĐ, trường không ánh xạ được.
import { describe, expect, test } from "bun:test";
import type { Snapshot, SourceDoc } from "./context";
import { buildOwnerPlan, ownerCtx, unitsOf, unmappedFields } from "./owner-plan.rules";
import { contractOwners, scopeToOwner } from "./owner-scope.rules";

const doc = (id: string, src: Record<string, unknown>): SourceDoc => ({
  id,
  src: { id, org_id: "o1", ...src },
});
const TIEN = "Tien@Old.Test";
const snap = (): Snapshot => ({
  graph: {},
  docs: {
    users: [doc("u1", { email: "tien@old.test", name: "Lê Thị Thuý Tiên" })],
    contracts: [
      doc("k1", {
        kind: "contract",
        owner_email: "tien@old.test",
        created_by: "x@old.test",
        title: "A",
        status: "active",
        fields: { total_value: { value: 10 } },
        misc: "y",
      }),
      doc("k2", {
        kind: "contract",
        owner_email: null,
        created_by: "tien@old.test",
        title: "B",
        status: "active",
        fields: {},
      }),
      doc("k3", {
        kind: "addendum",
        parent_id: "k1",
        owner_email: "demo@old.test",
        title: "PL",
        status: "active",
        fields: {},
      }),
      doc("k9", {
        kind: "contract",
        owner_email: "demo@old.test",
        title: "Demo",
        status: "active",
        fields: {},
      }),
    ],
    obligations: [
      doc("o1", {
        contract_id: "k1",
        direction: "pay",
        due_date: "2026-01-01",
        amount: 5,
        company_id: "o1|tax:0101",
      }),
      doc("o9", { contract_id: "k9", direction: "pay", due_date: "2026-01-01", amount: 7 }),
    ],
    partner_events: [
      doc("1", {
        contract_id: "k1",
        type: "paid",
        role: "supplier",
        at: "2026-01-02",
        company_id: "o1|tax:0101",
      }),
      doc("2", {
        type: "rating",
        role: "supplier",
        at: "2026-01-03",
        by: "tien@old.test",
        company_id: "o1|tax:0202",
      }),
      doc("3", {
        type: "rating",
        role: "supplier",
        at: "2026-01-03",
        by: "demo@old.test",
        company_id: "o1|tax:0303",
      }),
    ],
    companies: [
      doc("o1|tax:0101", { name: "Bình An", tax_id: "0101" }),
      doc("o1|tax:0303", { name: "Demo" }),
    ],
    state: [
      doc("remind:k1:2026-03-01:7:tien@old.test", {}),
      doc("remind:k9:2026-03-01:7:demo@old.test", {}),
    ],
    followups: [doc("f1", { contract_id: "k1" }), doc("f9", { user_email: "demo@old.test" })],
  },
});

describe("niti-import · scopeToOwner", () => {
  test("chỉ dữ liệu của chủ; phụ lục theo HĐ cha; đánh giá tự do do chủ ghi; còn lại đếm loại / không nhập", () => {
    const s = scopeToOwner(snap(), TIEN);
    expect(s.snap.docs.contracts?.map((d) => d.id)).toEqual(["k1", "k2", "k3"]);
    expect(s.snap.docs.obligations?.map((d) => d.id)).toEqual(["o1"]);
    expect(s.snap.docs.partner_events?.map((d) => d.id)).toEqual(["1", "2"]);
    expect(s.snap.docs.companies?.map((d) => d.id)).toEqual(["o1|tax:0101"]);
    expect(s.snap.docs.state).toHaveLength(1);
    expect(s.excluded).toEqual({
      contracts: 1,
      obligations: 1,
      partner_events: 1,
      companies: 1,
      state: 1,
    });
    expect(s.not_imported).toEqual({ followups: 1 });
    expect(s.orgs).toEqual(["o1"]);
  });

  test("contractOwners: email + tên + số HĐ (tìm tài khoản cần nhập)", () => {
    expect(contractOwners(snap())[0]).toEqual({
      email: "tien@old.test",
      name: "Lê Thị Thuý Tiên",
      orgs: ["o1"],
      contracts: 2,
    });
  });

  test("kế hoạch: mọi HĐ thuộc user đích; mỗi HĐ một đơn vị (cha trước phụ lục); sự kiện không gắn HĐ ⇒ shared", () => {
    const scope = scopeToOwner(snap(), TIEN);
    const ctx = ownerCtx({ source: "s", tenantId: "t1", ownerEmail: TIEN, ownerId: "u-tien" }, []);
    const { plan } = buildOwnerPlan(scope, ctx, "u-tien");
    const t = plan.tenants.get("t1");
    expect(t?.rows["contracts.contracts"]?.map((r) => [r.owner_user_id, r.created_by])).toEqual([
      ["u-tien", "u-tien"],
      ["u-tien", "u-tien"],
      ["u-tien", "u-tien"],
    ]);
    const units = unitsOf(t as NonNullable<typeof t>);
    expect(units.map((u) => u.key.slice(0, 6))).toHaveLength(4);
    expect(units.at(-1)?.key).toBe("shared");
    expect(units.at(-1)?.tables.map(([x]) => x)).toEqual(["contracts.partner_events"]);
    const k1 = units[0]?.tables.map(([x]) => x);
    expect(k1).toContain("contracts.obligations");
    expect(k1).toContain("contracts.partner_events");
    expect(k1).toContain("contracts.contract_reminders");
  });

  test("trường nguồn không có chỗ ở đích được liệt kê", () => {
    expect(unmappedFields(scopeToOwner(snap(), TIEN).snap)).toEqual({ "contracts.misc": 1 });
  });
});
