// tool-tenant-purge · luật thuần: tham số, chọn tenant (trùng/platform), tập xoá, bảng lạ, thứ tự FK + bẻ vòng.
import { describe, expect, it } from "bun:test";
import {
  assertCovered,
  type Fk,
  fileboxIdOf,
  isFileColumn,
  orderTables,
  parsePurgeArgs,
  pickTenant,
  purgeSet,
  type TableInfo,
  unknownRefs,
} from "./tenant-purge.rules";

const T = (
  rel: string,
  tenantType: string | null = "uuid",
  tenantLike: string[] = [],
): TableInfo => ({
  rel,
  tenantType,
  tenantLike,
});
const fk = (child: string, parent: string, o: Partial<Fk> = {}): Fk => ({
  name: `${child}_${parent}_fk`,
  child,
  parent,
  cols: ["x_id"],
  pcols: ["id"],
  del: "a",
  deferrable: false,
  nullable: false,
  ...o,
});
const U1 = "11111111-1111-4111-8111-111111111111";

describe("tenant-purge · tham số", () => {
  it("mặc định chạy thử; --apply bắt buộc --confirm; cờ lạ bị từ chối", () => {
    expect(parsePurgeArgs(["--tenant", "acme"])).toMatchObject({ tenant: "acme", apply: false });
    expect(() => parsePurgeArgs(["--tenant", "acme", "--apply"])).toThrow(/--confirm/);
    expect(() => parsePurgeArgs(["--tenant", "acme", "--force"])).toThrow(/cờ lạ/);
    expect(() => parsePurgeArgs([])).toThrow(/--tenant/);
    expect(parsePurgeArgs(["--tenant", "a", "--apply", "--confirm", "A b"]).confirm).toBe("A b");
  });
});

describe("tenant-purge · chọn tenant", () => {
  const rows = [
    { id: U1, key: "acme", name: "Acme", platformAdmins: 0 },
    { id: "22222222-2222-4222-8222-222222222222", key: "dup1", name: "Trùng", platformAdmins: 0 },
    { id: "33333333-3333-4333-8333-333333333333", key: "dup2", name: "Trùng", platformAdmins: 0 },
    {
      id: "44444444-4444-4444-8444-444444444444",
      key: "platform",
      name: "Nền tảng",
      platformAdmins: 1,
    },
    { id: "55555555-5555-4555-8555-555555555555", key: "ops", name: "Ops", platformAdmins: 2 },
  ];
  it("theo uuid / key / tên chính xác; không khớp ⇒ null", () => {
    expect(pickTenant(rows, U1)?.key).toBe("acme");
    expect(pickTenant(rows, "acme")?.id).toBe(U1);
    expect(pickTenant(rows, "Acme")?.id).toBe(U1);
    expect(pickTenant(rows, "acm")).toBeNull();
  });
  it("tên trùng hoặc tenant platform (key/platform_admin) ⇒ từ chối", () => {
    expect(() => pickTenant(rows, "Trùng")).toThrow(/khớp 2/);
    expect(() => pickTenant(rows, "platform")).toThrow(/platform/);
    expect(() => pickTenant(rows, "ops")).toThrow(/platform/);
  });
});

describe("tenant-purge · kế hoạch", () => {
  it("tenant_id không phải uuid ⇒ FAIL; bảng FK lạ / cột giống tenant ⇒ báo", () => {
    expect(() => purgeSet([T("a.x", "text")])).toThrow(/không phải uuid/);
    const tables = [
      T("admin.tenants", null),
      T("a.users"),
      T("g.cfg", null, ["owner_tenant"]),
      T("g.cmd", null),
    ];
    const where = purgeSet(tables);
    const fks = [fk("z.probe", "a.users"), fk("g.cmd", "a.users", { del: "n", nullable: true })];
    expect(unknownRefs(tables, fks, where)).toEqual([
      "g.cfg (cột owner_tenant)",
      "z.probe (FK z.probe_a.users_fk → a.users, on delete a)",
    ]);
  });
  it("con trước cha, tenants cuối; vòng cascade bỏ qua; vòng nullable ⇒ preNull; vòng cứng ⇒ FAIL", () => {
    const tables = [
      T("admin.tenants", null),
      T("a.users"),
      T("a.groups"),
      T("a.members"),
      T("a.dept"),
    ];
    const where = purgeSet(tables);
    const base = [
      fk("a.members", "a.users"),
      fk("a.members", "a.groups"),
      fk("a.users", "admin.tenants"),
    ];
    const p = orderTables(where, base);
    expect(p.order.indexOf("a.members")).toBeLessThan(p.order.indexOf("a.users"));
    expect(p.order.at(-1)).toBe("admin.tenants");
    assertCovered(tables, p);
    const cyc = [...base, fk("a.dept", "a.users"), fk("a.users", "a.dept", { nullable: true })];
    const p2 = orderTables(where, cyc);
    expect(p2.preNull.map((f) => f.name)).toEqual(["a.users_a.dept_fk"]);
    expect(p2.order.indexOf("a.dept")).toBeLessThan(p2.order.indexOf("a.users"));
    const casc = [...base, fk("a.dept", "a.users"), fk("a.users", "a.dept", { del: "c" })];
    expect(orderTables(where, casc).preNull).toEqual([]);
    const hard = [...base, fk("a.dept", "a.users"), fk("a.users", "a.dept")];
    expect(() => orderTables(where, hard)).toThrow(/vòng FK/);
    const def = [...base, fk("a.dept", "a.users"), fk("a.users", "a.dept", { deferrable: true })];
    expect(orderTables(where, def).deferred).toHaveLength(1);
  });
  it("bảng tenant_id thiếu trong thứ tự ⇒ FAIL", () => {
    const p = orderTables(purgeSet([T("a.x")]), []);
    expect(() => assertCovered([T("a.x"), T("a.new")], p)).toThrow(/a\.new/);
  });
  it("cột file FileBox", () => {
    expect(isFileColumn("file_id", "uuid")).toBe("id");
    expect(isFileColumn("filebox_file_id", "text")).toBe("id");
    expect(isFileColumn("storage_key", "text")).toBe("locator");
    expect(isFileColumn("profile_id", "uuid")).toBeNull();
    expect(isFileColumn("file_id", "integer")).toBeNull();
    expect(fileboxIdOf("fb/abc")).toBe("abc");
    expect(fileboxIdOf("t/abc")).toBeNull();
  });
});
