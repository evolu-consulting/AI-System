// HUB-FR-78, HUB-FR-87 · unit B1 H3b: `dbHubAudit` (plan-db §3) — cột/tham số, jsonb bằng chuỗi, cắt `entity_name`.
import { describe, expect, test } from "bun:test";
import type { Tx } from "@ai/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  AUDIT_ENTITY_NAME_MAX,
  clipEntityName,
  dbHubAudit,
  grantEntityName,
  type HubAuditRow,
} from "./hub-audit";

const dialect = new PgDialect();
const TID = "a0000000-0000-4000-8000-000000000001";
const ID = "a0000000-0000-4000-8000-0000000000f1";

function fakeTx() {
  const seen: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: async (q: SQL) => {
      const r = dialect.sqlToQuery(q);
      seen.push({ sql: r.sql.replace(/\s+/g, " "), params: r.params });
      return [];
    },
  };
  return { tx: tx as unknown as Tx, seen };
}

const grantRow: HubAuditRow = {
  tenantId: TID,
  actorId: ID,
  actorUsername: "lan",
  actorRole: "tenant_admin",
  action: "grant",
  entity: "agent_grant",
  entityId: ID,
  entityName: grantEntityName("hoadon", "ke-toan"),
  hubConfigVersion: 3,
  before: null,
  after: { agent_id: ID, agent_key: "hoadon" },
  summary: {},
};

describe("H3b B1 · hub-audit", () => {
  test("HUB-FR-78 · grant: một INSERT hub.audit_log, jsonb là chuỗi JSON, before NULL", async () => {
    const { tx, seen } = fakeTx();
    await dbHubAudit.insert(tx, grantRow);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.sql).toContain("insert into hub.audit_log");
    expect(seen[0]?.params).toEqual([
      TID,
      ID,
      "lan",
      "tenant_admin",
      "grant",
      "agent_grant",
      ID,
      "hoadon → ke-toan",
      3,
      null,
      JSON.stringify(grantRow.after),
      "{}",
    ]);
  });

  test("HUB-FR-87 · view_trace: entity_name rỗng, version NULL, summary giữ nguyên", async () => {
    const { tx, seen } = fakeTx();
    const summary = { run_user_id: ID, run_status: "done" };
    await dbHubAudit.insert(tx, {
      ...grantRow,
      actorRole: "platform_admin",
      action: "view_trace",
      entity: "run",
      entityName: "",
      hubConfigVersion: null,
      after: null,
      summary,
    });
    const p = seen[0]?.params ?? [];
    expect(p[7]).toBe("");
    expect(p[8]).toBeNull();
    expect(p[10]).toBeNull();
    expect(p[11]).toBe(JSON.stringify(summary));
  });
});

describe("H3b B1 · hub-audit entity_name", () => {
  test("HUB-FR-78 · entity_name > 200 ký tự bị cắt theo code point", async () => {
    const long = "😀".repeat(AUDIT_ENTITY_NAME_MAX + 5);
    const clipped = clipEntityName(long);
    expect(Array.from(clipped)).toHaveLength(AUDIT_ENTITY_NAME_MAX);
    expect(clipEntityName("ngắn")).toBe("ngắn");
    const { tx, seen } = fakeTx();
    await dbHubAudit.insert(tx, { ...grantRow, entityName: long });
    expect(seen[0]?.params[7]).toBe(clipped);
  });
});
