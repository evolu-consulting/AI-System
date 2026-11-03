// CR-112 · ADM-FR-76 AC1 / ADM-FR-77 AC2 · danh sách công ty trong sidebar theo vai.
import { describe, expect, test } from "bun:test";
import { canCreateCompany, canSearchCompanies, companyEntries } from "./companies";

const list = [
  { id: "1", key: "acme", name: "Acme Corp", status: "active" },
  { id: "2", key: "globex", name: "Globex", status: "locked" },
  { id: "3", key: "wayne", name: "Wayne Enterprises", status: "active" },
];
const own = { id: "2", key: "globex", name: "Globex" };

describe("ADM-FR-76 · companyEntries", () => {
  test("platform_admin: mọi công ty, lọc theo tên hoặc mã không phân biệt hoa thường", () => {
    expect(companyEntries("platform_admin", own, list, "").map((c) => c.key)).toEqual([
      "acme",
      "globex",
      "wayne",
    ]);
    expect(companyEntries("platform_admin", own, list, "  WAYNE ").map((c) => c.key)).toEqual([
      "wayne",
    ]);
    expect(companyEntries("platform_admin", own, list, "acm").map((c) => c.id)).toEqual(["1"]);
    expect(companyEntries("platform_admin", own, list, "zzz")).toEqual([]);
    expect(companyEntries("platform_admin", own, list, "")[1]?.locked).toBe(true);
  });

  test("platform_admin: chưa tải/chưa có công ty ⇒ rỗng", () => {
    expect(companyEntries("platform_admin", own, undefined, "")).toEqual([]);
    expect(companyEntries("platform_admin", own, [], "")).toEqual([]);
  });

  test("ADM-FR-77 · tenant_admin chỉ công ty mình, bỏ qua danh sách và ô tìm", () => {
    expect(companyEntries("tenant_admin", own, list, "acme")).toEqual([
      { id: "2", key: "globex", name: "Globex", locked: false },
    ]);
    expect(companyEntries("tenant_admin", undefined, list, "")).toEqual([]);
  });

  test("member/chưa đăng nhập không có công ty; chỉ platform_admin tìm và tạo", () => {
    expect(companyEntries("member", own, list, "")).toEqual([]);
    expect(companyEntries(undefined, own, list, "")).toEqual([]);
    expect(canSearchCompanies("platform_admin")).toBe(true);
    expect(canSearchCompanies("tenant_admin")).toBe(false);
    expect(canCreateCompany("tenant_admin")).toBe(false);
  });
});
