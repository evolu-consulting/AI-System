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
});
