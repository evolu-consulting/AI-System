import { describe, expect, test } from "bun:test";
import { features, secrets } from "@ai/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { likeArg, outer, usernameOf } from "./sql";

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
});
