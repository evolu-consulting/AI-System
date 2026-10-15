// HUB-FR-138 · FB1-AC-11 (vế storage) · scope CORE-ONLY: KHÔNG có vòng sweeper gọi `DELETE /files` (đã bỏ khỏi phạm vi) — chỉ giữ hợp đồng
// storage mà sweeper local sẵn có dựa vào: `list ⇒ []` (không có mồ côi/.part ở FileBox), `promote` no-op, và `sweepOnce` không gọi FileBox
// khi không có hàng cần xử lý. `discard` = DELETE lúc upload dở được kiểm ở `upload.int` (b1–b2).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { logger } from "../../../apps/hub-api/src/lib/logger";
import { sweepOnce } from "../../../apps/hub-api/src/modules/attachments/sweeper";
import { type Keys, makeKeys, type Sql } from "../H1/_fixtures";
import { setupH2c } from "../H2c/_h2c";
import { type FbFake, type HubFb, needFb, startFbFake, startHubFb } from "./_fb1";

let sql: Sql;
let k: Keys;
let fake: FbFake;
let hub: HubFb;

beforeAll(async () => {
  sql = await setupH2c();
  k = await makeKeys();
  fake = startFbFake();
  hub = await startHubFb(k, { fake });
}, 60_000);
beforeEach(async () => {
  fake.reset();
  await sql`delete from hub.attachments`;
});
afterAll(async () => {
  await hub?.stop();
  await fake?.close();
  await sql?.end();
});

describe("FB1-AC-11 · hợp đồng storage cho sweeper [HUB-FR-138 · §3.1]", () => {
  it("HUB-FR-138 · FB1-AC-11 · t4 · mồ côi: storage.list ⇒ [] và sweepOnce không gọi FileBox khi không có hàng cần xử lý (orphans = 0)", async () => {
    await needFb(sql, hub);
    expect(await hub.storage?.list({ after: null, limit: 100 })).toEqual([]);
    const r = await sweepOnce({
      db: hub.db,
      storage: hub.storage as NonNullable<typeof hub.storage>,
      now: new Date(Date.now() + 2 * 3_600_000),
      log: logger,
    });
    expect(r.orphans).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("HUB-FR-138 · FB1-AC-11 · t5 · promote no-op: storage.promote(fb/…) không ném và không gọi FileBox", async () => {
    await needFb(sql, hub);
    await hub.storage?.promote("fb/bat-ky");
    expect(fake.calls).toEqual([]);
  });
});
