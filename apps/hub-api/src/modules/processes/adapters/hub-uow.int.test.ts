// HUB-FR-143 · CA-R06/R07 · plan-addendum A7 Q4, A11 · `UnitOfWork.systemBatch` (role hub_api): outbox phát SAU COMMIT
// đúng một lần, fn ném ⇒ 0 lần, 40P01 chạy lại ⇒ chỉ sự kiện lần thành công; repo lô bọc SQL theo tập sẵn có (lô rỗng
// không ghi gì, notifier lô rỗng không phát). `tenant`/`system` đã có test khoá `tests/acceptance/P-d/d1/uow.int`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { HUB_API_URL, prepareDb } from "../../../../../../tests/acceptance/H1/_fixtures";
import { connectDb, type Db } from "../../../lib/db";
import type { OutboxEvent } from "../application/ports";
import { claimTx, createHubUow } from "./hub-uow";

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

const TID = "a1000000-0000-4000-8000-000000000001";

/** Db bọc: lần đầu `fn` của tx chạy xong thì ném 40001 (tx ROLLBACK) ⇒ `withHubScope` chạy lại cả tx. */
function flakyOnce(real: Db): Db {
  let thrown = false;
  const drz = real.db as unknown as {
    transaction(cb: (tx: Tx) => Promise<unknown>): Promise<unknown>;
  };
  const transaction = (cb: (tx: Tx) => Promise<unknown>, cfg?: unknown) =>
    (
      real.db.transaction as (cb: (tx: Tx) => Promise<unknown>, c?: unknown) => Promise<unknown>
    ).call(
      drz,
      async (tx: Tx) => {
        const out = await cb(tx);
        if (!thrown) {
          thrown = true;
          throw Object.assign(new Error("serialization"), { code: "40001" });
        }
        return out;
      },
      cfg,
    );
  const bind = (o: object, k: string | symbol) => {
    const v = Reflect.get(o, k);
    return typeof v === "function" ? v.bind(o) : v;
  };
  const inner = new Proxy(drz, { get: (o, k) => (k === "transaction" ? transaction : bind(o, k)) });
  return new Proxy(real, { get: (o, k) => (k === "db" ? inner : bind(o, k)) }) as Db;
}

describe("CR-115 · systemEach", () => {
  it("TB1 · hàng ném SAU khi đã ghi ⇒ ROLLBACK savepoint (ghi mất), sự kiện của hàng bỏ; hàng khác giữ; tenant sai ⇒ ok:false, fn không chạy; publish đánh dấu lô", async () => {
    const published: { events: readonly OutboxEvent[]; opts: unknown }[] = [];
    const uow = createHubUow(db, {
      clock: { now: () => new Date() },
      publish: async (events, opts) => void published.push({ events, opts }),
    });
    let tx: Tx | undefined;
    const ran: number[] = [];
    const out = await uow.systemEach(
      async (t) => {
        tx = claimTx(t);
        return [1, 2, 3, 4];
      },
      (n) => (n === 4 ? "không-phải-uuid" : TID),
      async (r, n) => {
        ran.push(n);
        // ghi cục bộ tx (set_config is_local): ROLLBACK savepoint hoàn lại như mọi ghi khác.
        await (tx as Tx).execute(sql`select set_config('qc.each',
          coalesce(current_setting('qc.each', true), '') || ${String(n)}, true)`);
        r.outbox.emit(ev(n));
        if (n === 2) throw new Error("requeue lỗi");
        if (n !== 3) return String(n);
        const [row] = await (tx as Tx).execute<{ v: string }>(
          sql`select current_setting('qc.each', true) as v`,
        );
        return row?.v;
      },
    );
    expect({
      ran,
      out: out.map((x) => {
        const e = x.ok ? null : (x.error as Error & { code?: string });
        return e ? `lỗi:${e.code ?? e.message}` : x.ok && x.value;
      }),
      published,
    }).toEqual({
      ran: [1, 2, 3],
      out: ["1", "lỗi:requeue lỗi", "13", "lỗi:TENANT_INVALID"],
      published: [{ events: [ev(1), ev(3)], opts: { kickMany: true } }],
    });
  });

  it("TB1 · 40001 lúc COMMIT lần 1 ⇒ chạy lại cả tx: kết quả + sự kiện chỉ của lần 2, publish đúng 1 lần", async () => {
    const published: (readonly OutboxEvent[])[] = [];
    const uow = createHubUow(flakyOnce(db), {
      clock: { now: () => new Date() },
      publish: async (events) => void published.push(events),
    });
    let attempt = 0;
    const out = await uow.systemEach(
      async () => {
        attempt += 1;
        return [1, 2];
      },
      () => TID,
      async (r, n) => {
        r.outbox.emit(ev(attempt * 10 + n));
        return attempt * 10 + n;
      },
    );
    expect({ attempt, out: out.map((x) => (x.ok ? x.value : "lỗi")), published }).toEqual({
      attempt: 2,
      out: [21, 22],
      published: [[ev(21), ev(22)]],
    });
  });
});
