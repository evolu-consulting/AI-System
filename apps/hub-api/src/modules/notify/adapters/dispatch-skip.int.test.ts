// Prod-fixes1 · bản gửi bị transport bỏ qua (miền dành riêng) ⇒ status `skipped` + lý do, không tính lỗi/thử lại/dead.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  needNotify,
  notice,
  P,
  resetNotify,
  type Sql,
  send,
  setupX2a,
  startWorker,
  T,
  type Worker,
} from "../../../../../../tests/acceptance/N3/_support/n3";
import { dispatchOnce } from "../application/dispatch.usecase";
import { skippedReserved } from "../domain/notify.rules";

let sql: Sql;
let w: Worker;
beforeAll(async () => {
  sql = await setupX2a();
  await needNotify(sql);
});
afterAll(async () => {
  await sql.end();
});
beforeEach(async () => {
  await resetNotify(sql);
  w = startWorker();
});
afterEach(async () => {
  await w.stop();
});

describe("bỏ qua email tới miền dành riêng", () => {
  it("skip ⇒ status skipped, last_error = mã lý do, attempts 1, không retry/dead, không gửi lại", async () => {
    w.email.script = () => skippedReserved;
    await send(T.acme, [notice(P.lan.id)]);
    const r = await dispatchOnce(w.deps);
    expect(r).toMatchObject({ claimed: 1, sent: 0, retried: 0, dead: 0, skipped: 1 });
    const rows = await sql<{ status: string; last_error: string | null; attempts: number }[]>`
      select status, last_error, attempts from hub.notification_deliveries where channel = 'email'`;
    expect([...rows]).toEqual([
      { status: "skipped", last_error: "skipped_reserved_domain", attempts: 1 },
    ]);
    w.clock.advance(7200);
    expect((await dispatchOnce(w.deps)).claimed).toBe(0);
  });
});
