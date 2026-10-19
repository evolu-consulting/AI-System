// PK-FR-08 · PK-NFR-03 · N1 plan §8: `indexOutboxRepo` — lô rỗng 0 câu; lô n hàng đúng 1 câu, văn bản hằng (lô qua MỘT tham
// số jsonb, tenant tham số); khoá gói sai ⇒ ném trước khi dựng câu.
import { describe, expect, test } from "bun:test";
import type { Tx } from "@ai/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { indexOutboxRepo } from "./index-outbox.repo";

const TID = "a5e10000-0000-4000-8000-000000000001";
const id = (n: number) => `a5e10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dialect = new PgDialect();

function fakeTx() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: async (q: SQL) => {
      calls.push(dialect.sqlToQuery(q));
      return [];
    },
  } as unknown as Tx;
  return { tx, calls };
}

describe("PK-FR-08 · indexOutboxRepo", () => {
  test("lô rỗng ⇒ 0 câu", async () => {
    const f = fakeTx();
    await indexOutboxRepo(f.tx, "pkdemo", TID).enqueue([]);
    expect(f.calls).toEqual([]);
  });

  test("1 hàng và 100 hàng ⇒ đúng 1 câu mỗi lần, cùng văn bản SQL, 2 tham số (tenant, jsonb)", async () => {
    const f = fakeTx();
    const repo = indexOutboxRepo(f.tx, "pkdemo", TID);
    await repo.enqueue([{ entity: "item", entity_id: id(1), op: "upsert" }]);
    const many = Array.from({ length: 100 }, (_, i) => ({
      entity: "item",
      entity_id: id(i + 2),
      op: "delete" as const,
    }));
    await repo.enqueue(many);
    expect(f.calls.length).toBe(2);
    const [a, b] = f.calls;
    expect(a?.sql).toBe(b?.sql ?? "");
    expect(a?.sql).toMatch(
      /^insert into pkdemo\.index_outbox \(tenant_id, entity, entity_id, op\)/,
    );
    expect(a?.sql).toContain("jsonb_to_recordset");
    expect(a?.params).toEqual([
      TID,
      JSON.stringify([{ entity: "item", entity_id: id(1), op: "upsert" }]),
    ]);
    expect(JSON.parse(String(b?.params[1])).length).toBe(100);
  });

  test("khoá gói sai dạng ⇒ ném, không chạy câu nào", () => {
    const f = fakeTx();
    expect(() => indexOutboxRepo(f.tx, "x; drop table y", TID)).toThrow();
    expect(f.calls).toEqual([]);
  });
});
