// HUB-FR-143 · CA-R06/R07 · plan-addendum A7 Q4, A11 · `UnitOfWork.systemBatch` (role hub_api): outbox phát SAU COMMIT
// đúng một lần, fn ném ⇒ 0 lần, 40P01 chạy lại ⇒ chỉ sự kiện lần thành công; repo lô bọc SQL theo tập sẵn có (lô rỗng
// không ghi gì, notifier lô rỗng không phát). `tenant`/`system` đã có test khoá `tests/acceptance/P-d/d1/uow.int`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { HUB_API_URL, prepareDb } from "../../../../../../tests/acceptance/H1/_fixtures";
import { connectDb, type Db } from "../../../lib/db";
import type { OutboxEvent } from "../application/ports";
import { createHubUow } from "./hub-uow";

let db: Db;
beforeAll(async () => {
  await prepareDb();
  db = connectDb(HUB_API_URL, 2);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

function makeUow() {
  const published: (readonly OutboxEvent[])[] = [];
  const uow = createHubUow(db, {
    clock: { now: () => new Date() },
    publish: async (events) => void published.push(events),
  });
  return { uow, published };
}
const ev = (n: number): OutboxEvent => ({ kind: "user_events", events: [n] });

describe("A11 · systemBatch", () => {
  it("HUB-FR-143 · lô rỗng: 0 hàng, more=false, notifier không phát; không sự kiện ⇒ không gọi publish", async () => {
    const { uow, published } = makeUow();
    const now = new Date();
    const out = await uow.systemBatch(async (r) => {
      const reminders = await r.reviewTasks.claimDueReminders(0, now);
      const expired = await r.runs.claimExpired(0, now);
      await r.threads.insertRunEnds([]);
      await r.notifier.runsFinished([]);
      const notices = await r.notices.insertMany("reminder", []);
      return { reminders, expired, inserted: notices.inserted.length };
    });
    expect(out).toEqual({
      reminders: { tasks: [], claimed: 0, more: false },
      expired: { runs: [], more: false },
      inserted: 0,
    });
    expect(published).toEqual([]);
  });

  it("HUB-FR-143 · Q4 · emit rồi ném ⇒ publish 0; 40P01 lần 1 ⇒ chạy lại, publish đúng 1 lần sự kiện lần 2", async () => {
    const { uow, published } = makeUow();
    const failed = await uow
      .systemBatch(async (r) => {
        r.outbox.emit(ev(1));
        throw new Error("lỗi nghiệp vụ");
      })
      .catch((e: Error) => e.message);
    expect({ failed, published }).toEqual({ failed: "lỗi nghiệp vụ", published: [] });
    let n = 0;
    const out = await uow.systemBatch(async (r) => {
      n += 1;
      r.outbox.emit(ev(n));
      if (n === 1) throw Object.assign(new Error("deadlock"), { code: "40P01" });
      return "ok";
    });
    expect({ out, n, published }).toEqual({ out: "ok", n: 2, published: [[ev(2)]] });
  });
});
