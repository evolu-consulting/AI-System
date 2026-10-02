// ADM-FR-53 · bump `config_version` trong transaction, sink mới mỗi lần thử (plan M3 §5.2). Không NOTIFY ở đây.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createDb } from "./client";
import { withConfigWrite } from "./config-meta";
import { runMigrations } from "./migrate";
import { NIL_SCOPE } from "./scope";
import { resetTestDb } from "./test-db";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 2 });
const platform = { kind: "platform" } as const;
const ev = { entity: "feature", tenantId: null } as const;
const ev2 = { entity: "command", tenantId: null } as const;
const cfg = async () =>
  (await owner<{ v: number }[]>`select config_version as v from admin.config_meta`)[0]?.v ?? -1;

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
});
beforeEach(async () => {
  await owner`insert into admin.config_meta (id, config_version) values (1, 0)
    on conflict (id) do update set config_version = 0`;
});
afterAll(async () => {
  await owner.end();
  await db.close();
});

describe("ADM-FR-53 · withConfigWrite (M3-R15)", () => {
  test("có sự kiện → +1 đúng một lần dù nhiều sự kiện; trả version và events", async () => {
    const r = await withConfigWrite(db, platform, async (_tx, ch) => {
      ch.changed(ev);
      ch.changed(ev2);
      return "ok";
    });
    expect(r).toEqual({ result: "ok", version: 1, events: [ev, ev2] });
    expect(await cfg()).toBe(1);
  });

  test("không sự kiện → không bump, version null, beforeBump không chạy", async () => {
    let hooked = 0;
    const r = await withConfigWrite(db, platform, async () => 1, {
      beforeBump: async () => {
        hooked += 1;
      },
    });
    expect(r.version).toBeNull();
    expect(hooked).toBe(0);
    expect(await cfg()).toBe(0);
  });

  test("ném sau khi đã ghi sự kiện → rollback, không tăng", async () => {
    const run = withConfigWrite(db, platform, async (_tx, ch) => {
      ch.changed(ev);
      throw new Error("luật");
    });
    await expect(run).rejects.toThrow("luật");
    expect(await cfg()).toBe(0);
  });
});

describe("ADM-FR-53 · withConfigWrite retry và upsert", () => {
  test("40P01 ở beforeBump lần đầu → chạy lại, sink mới: +1 một lần, events không nhân đôi", async () => {
    let calls = 0;
    const beforeBump = async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("test deadlock"), { code: "40P01" });
    };
    const r = await withConfigWrite(db, platform, async (_tx, ch) => ch.changed(ev), {
      beforeBump,
    });
    expect(calls).toBe(2);
    expect(r.events).toEqual([ev]);
    expect(r.version).toBe(1);
    expect(await cfg()).toBe(1);
  });

  test("hàng config_meta bị xoá → upsert tạo lại với 1 (scope tenant cũng ghi được)", async () => {
    await owner`delete from admin.config_meta`;
    const r = await withConfigWrite(db, NIL_SCOPE, async (_tx, ch) => ch.changed(ev));
    expect(r.version).toBe(1);
    expect(await cfg()).toBe(1);
  });
});
