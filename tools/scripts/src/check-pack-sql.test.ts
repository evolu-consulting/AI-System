import { describe, expect, test } from "bun:test";
import { checkPackSql } from "./check-pack-sql";

describe("check-pack-sql", () => {
  test("schema của gói + packs.secure_table + pg_catalog + comment: sạch", () => {
    const sql = `-- admin.groups chỉ trong comment\nCREATE TABLE contracts.t (id int);\nSELECT packs.secure_table('contracts', 'admin.x');\nSET search_path = pg_catalog;`;
    expect(checkPackSql("contracts", sql)).toEqual([]);
  });
  test("đọc bảng admin, hàm packs lạ, schema khác: bắt", () => {
    const sql = `SELECT 1 FROM admin.users u;\nSELECT packs.drop_all();\nCREATE SCHEMA other;\nSELECT 1 FROM knowledge.docs;`;
    expect(checkPackSql("contracts", sql).map((f) => f.ref)).toEqual([
      "admin.users",
      "packs.drop_all",
      "other",
      "knowledge.docs",
    ]);
  });
  test("ADR-0043: community gọi đúng hàm contracts.community_partners được; bảng/hàm khác của contracts bị bắt; contracts tự tham chiếu mình sạch", () => {
    const ok = "SELECT * FROM contracts.community_partners(ARRAY[o]);";
    const bad = `SELECT * FROM contracts.partner_profiles;\nSELECT contracts.fold('x');\nSELECT 1 FROM community.posts;`;
    expect(checkPackSql("community", ok)).toEqual([]);
    expect(checkPackSql("community", bad).map((f) => f.ref)).toEqual([
      "contracts.partner_profiles",
      "contracts.fold",
    ]);
    expect(
      checkPackSql("contracts", "SELECT contracts.fold(name) FROM contracts.partner_roles;"),
    ).toEqual([]);
    expect(checkPackSql("contracts", "SELECT 1 FROM community.posts;").map((f) => f.ref)).toEqual([
      "community.posts",
    ]);
  });
});
