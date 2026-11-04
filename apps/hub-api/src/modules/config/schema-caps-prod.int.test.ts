// CR-118 · cr118-schema-caps-prod · thiếu `packs.pack_agents`: production ⇒ boot ném (liệt kê phần thiếu), test ⇒ chạy mềm;
// migrate sau khi Hub chạy ⇒ lần nạp lại kế (ConfigCache.reloadHub) dò lại và đọc bảng, không cần khởi động lại. DB clone riêng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { logger } from "../../lib/logger";
import { ConfigCache, dbConfigSource } from "./config.service";
import { assertHubSchemaCaps, hubSchemaCaps } from "./schema-caps";

let o: Sql;
const dbs: Db[] = [];
const hubDb = () => {
  const d = connectDb(urls().hubApi, 2);
  dbs.push(d);
  return d;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(1);
  await o`alter table packs.pack_agents rename to pack_agents_hidden_cp`;
}, 120_000);
afterAll(async () => {
  for (const d of dbs) await d.close();
  await o?.end({ timeout: 2 });
});

describe("CR-118 · cr118-schema-caps-prod", () => {
  it("production thiếu ⇒ ném liệt kê packAgents, test ⇒ không ném", async () => {
    const db = hubDb();
    const prod = await assertHubSchemaCaps("production", db).then(
      () => "ok",
      (e: Error) => e.message,
    );
    expect(prod).toContain("packAgents");
    expect((await assertHubSchemaCaps("test", db)).packAgents).toBe(false);
  });

  it("migrate sau khi chạy ⇒ lần nạp lại kế dò lại và thấy bảng", async () => {
    const db = hubDb();
    const ac = new AbortController();
    const cache = new ConfigCache(dbConfigSource(db), {
      pollS: 3600,
      log: logger,
      signal: ac.signal,
    });
    try {
      await cache.snapshot();
      expect((await hubSchemaCaps(db)).packAgents).toBe(false);
      await o`alter table packs.pack_agents_hidden_cp rename to pack_agents`;
      await cache.reloadHub();
      expect((await hubSchemaCaps(db)).packAgents).toBe(true);
      await cache.reloadHub(); // đủ ⇒ không dò thêm (memo giữ nguyên)
      const p = hubSchemaCaps(db);
      expect(hubSchemaCaps(db)).toBe(p);
    } finally {
      ac.abort();
      await cache.stop();
    }
  });
});
