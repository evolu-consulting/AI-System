// HUB-FR-78 · unit B1 H3b: khoá/bump/NOTIFY `config_meta` (plan-db §2) — câu SQL + payload; DB thật ở int H3b (QW).
import { describe, expect, test } from "bun:test";
import { HUB_CONFIG_CHANNEL, HubConfigChangedPayloadSchema } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  bumpHubConfig,
  hubConfigPayload,
  lockHubConfig,
  notifyHubConfig,
} from "./hub-config-write";

const dialect = new PgDialect();
type Seen = { sql: string; params: unknown[] };

function fakeTx(rows: unknown[]): { tx: Tx; seen: Seen[] } {
  const seen: Seen[] = [];
  const tx = {
    execute: async (q: SQL) => {
      const r = dialect.sqlToQuery(q);
      seen.push({ sql: r.sql.replace(/\s+/g, " "), params: r.params });
      return rows;
    },
  };
  return { tx: tx as unknown as Tx, seen };
}

describe("H3b B1 · hub-config-write", () => {
  test("HUB-FR-78 · lockHubConfig: SELECT … FOR UPDATE, trả version (số)", async () => {
    const { tx, seen } = fakeTx([{ v: "7" }]);
    expect(await lockHubConfig(tx)).toBe(7);
    expect(seen[0]?.sql).toContain("from hub.config_meta where id = 1 for update");
  });

  test("HUB-FR-78 · bumpHubConfig: UPDATE +1 RETURNING", async () => {
    const { tx, seen } = fakeTx([{ v: 8 }]);
    expect(await bumpHubConfig(tx)).toBe(8);
    expect(seen[0]?.sql).toContain("set hub_config_version = hub_config_version + 1 where id = 1");
    expect(seen[0]?.sql).toContain("returning hub_config_version as v");
  });

  test("HUB-FR-78 · thiếu hàng id=1 ⇒ ném", async () => {
    const { tx } = fakeTx([]);
    await expect(lockHubConfig(tx)).rejects.toThrow("config_meta");
    await expect(bumpHubConfig(tx)).rejects.toThrow("config_meta");
  });

  test("HUB-FR-78 · notifyHubConfig: pg_notify kênh hub_config_changed, payload hợp contract", async () => {
    const { tx, seen } = fakeTx([]);
    await notifyHubConfig(tx, 9);
    expect(seen[0]?.sql).toContain("pg_notify");
    expect(seen[0]?.params).toEqual([HUB_CONFIG_CHANNEL, hubConfigPayload(9)]);
    expect(HubConfigChangedPayloadSchema.parse(JSON.parse(hubConfigPayload(9))).version).toBe(9);
  });
});
