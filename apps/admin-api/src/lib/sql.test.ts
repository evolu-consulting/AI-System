import { describe, expect, test } from "bun:test";
import { features, secrets } from "@ai/db";
import { PgDialect, pgTable, uuid } from "drizzle-orm/pg-core";
import { likeArg, outer, pgArray, usernameOf } from "./sql";

const render = (s: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(s).sql;

describe("ADM-FR-50 · lib/sql", () => {
  test("ADM-FR-04 · likeArg thoát ký tự đại diện", () => {
    expect(likeArg("a_b%")).toBe("%a\\_b\\%%");
  });

  test("ADM-FR-50 · outer luôn ghi đủ schema.bảng.cột (subquery tương quan trong câu một bảng)", () => {
    expect(render(outer(secrets.id))).toBe('"admin"."secrets"."id"');
    expect(render(outer(features.updatedBy))).toBe('"admin"."features"."updated_by"');
    expect(render(usernameOf(secrets.updatedBy))).toContain('= "admin"."secrets"."updated_by"');
  });

  test("ADM-FR-50 · outer từ chối tên chứa dấu nháy kép", () => {
    const bad = pgTable('x"y', { id: uuid("id") });
    expect(() => outer(bad.id)).toThrow("outer: tên không hợp lệ");
  });
});

describe("ADM-FR-62 · pgArray", () => {
  test("một tham số literal mảng, thoát dấu \\ và dấu nháy kép; rỗng → {}", () => {
    const q = new PgDialect().sqlToQuery(pgArray(['a"b', "c\\d"], "text"));
    expect(q.sql).toBe("$1::text[]");
    expect(q.params).toEqual(['{"a\\"b","c\\\\d"}']);
    expect(new PgDialect().sqlToQuery(pgArray([], "uuid")).params).toEqual(["{}"]);
  });
});
