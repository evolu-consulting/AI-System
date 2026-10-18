// ADM-NFR-06 · MIGRATE_LOCK: nhiều tiến trình migrate song song trên các DB khác nhau (worker `test:int:par`) không còn lỗi
// XX000 `tuple concurrently updated` ở `ALTER ROLE` của migration (role là đối tượng của cụm).
import { afterAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { resetTestDb, withDatabase } from "./test-db";
import { dbNameOf } from "./test-db-template";

const BASE = process.env.TEST_DATABASE_URL;
if (!BASE) throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const stem = dbNameOf(BASE).slice(0, -"_test".length);
const urls = [0, 1, 2, 3].map((i) => withDatabase(BASE, `${stem}_mlock${i}_test`));
const maint = postgres(withDatabase(BASE, "postgres"), { max: 1, onnotice: () => {} });

afterAll(async () => {
  for (const u of urls) await maint.unsafe(`DROP DATABASE IF EXISTS "${dbNameOf(u)}" WITH (FORCE)`);
  await maint.end();
});

describe("ADM-NFR-06 · khoá migrate toàn cụm (int)", () => {
  test("4 DB migrate Admin + Hub cùng lúc ⇒ cả 4 xong, cùng số migration (không XX000 ở ALTER ROLE)", async () => {
    for (const u of urls) {
      const [r] = await maint`select 1 as one from pg_database where datname = ${dbNameOf(u)}`;
      if (!r) await maint.unsafe(`CREATE DATABASE "${dbNameOf(u)}"`);
      await resetTestDb(u);
    }
    const res = await Promise.all(
      urls.map(async (url) => ({
        main: await runMigrations({ url, appEnv: "test" }),
        hub: await runHubMigrations({ url, appEnv: "test" }),
      })),
    );
    for (const r of res) {
      expect(r.main.main).toBeGreaterThan(0);
      expect(r.hub.hub).toBeGreaterThan(0);
    }
    expect(new Set(res.map((r) => JSON.stringify(r))).size).toBe(1);
  }, 120_000);
});
