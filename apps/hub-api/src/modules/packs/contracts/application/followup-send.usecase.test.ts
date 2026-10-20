// W1b · vòng gửi hẹn nhắc (review B #8): một hàng xấu (lỗi dữ liệu) không chặn hàng đợi; lỗi khác không bỏ hàng nào.
import { describe, expect, it } from "bun:test";
import {
  createFollowupSender,
  type FollowupSendRepo,
  isDataError,
  pgStateOf,
} from "./followup-send.usecase";

type Row = { id: string; bad: boolean; status: "pending" | "sent" };
const pgErr = (code: string) => Object.assign(new Error("db"), { code });

/** Hàng đợi giả theo thứ tự hạn: lô có hàng `bad` ⇒ cả lô lỗi `fail` (như rollback của Postgres). */
function fakeQueue(rows: Row[], fail: () => Error) {
  const pending = () => rows.filter((r) => r.status === "pending");
  const repo: FollowupSendRepo = {
    async sendDue(_now, limit) {
      const take = pending().slice(0, limit);
      if (take.some((r) => r.bad)) throw fail();
      for (const r of take) r.status = "sent";
      return { claimed: take.length, notified: take.length };
    },
    async skipHead() {
      const h = pending()[0];
      if (!h) return null;
      h.status = "sent";
      return h.id;
    },
  };
  const warns: unknown[] = [];
  const sender = createFollowupSender({
    finder: { next: async (_n, skip) => (pending().length && !skip.includes("t") ? "t" : null) },
    uow: { system: (_t, fn) => fn({ followupSend: repo }) },
    timeZoneOf: async () => "Asia/Ho_Chi_Minh",
    now: () => new Date("2026-10-20T03:00:00Z"),
    batchSize: 10,
    log: { warn: (msg, meta) => warns.push({ msg, ...meta }) },
  });
  return { sender, warns };
}

describe("W1b · gửi hẹn nhắc: hàng xấu", () => {
  it("hàng đầu xấu (23514) ⇒ bỏ qua đúng hàng đó, các hàng sau vẫn gửi trong cùng drain", async () => {
    const rows: Row[] = [
      { id: "bad", bad: true, status: "pending" },
      { id: "a", bad: false, status: "pending" },
      { id: "b", bad: false, status: "pending" },
    ];
    const { sender, warns } = fakeQueue(rows, () => pgErr("23514"));
    const t = await sender.drain();
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
    expect(t).toMatchObject({ claimed: 3, notified: 2, failed: 0 });
    expect(warns).toEqual([
      { msg: "contracts-followup-skipped", tenantId: "t", followupId: "bad", code: "23514" },
    ]);
  });
  it("hàng xấu ở giữa ⇒ hàng trước gửi từng hàng, hàng xấu bị bỏ, hàng sau gửi tiếp", async () => {
    const rows: Row[] = ["a", "bad", "b"].map((id) => ({
      id,
      bad: id === "bad",
      status: "pending",
    }));
    const { sender } = fakeQueue(rows, () => pgErr("22001"));
    const t = await sender.drain();
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
    expect(t.notified).toBe(2);
  });
  it("lỗi không phải dữ liệu (mạng/khoá) ⇒ không bỏ hàng nào, tenant tính `failed`", async () => {
    const rows: Row[] = [{ id: "x", bad: true, status: "pending" }];
    const { sender, warns } = fakeQueue(rows, () => pgErr("40P01"));
    const t = await sender.drain();
    expect([rows[0]?.status, t.failed]).toEqual(["pending", 1]);
    expect(warns.map((w) => (w as { msg: string }).msg)).toEqual([
      "contracts-followup-send-failed",
    ]);
  });
  it("pgStateOf / isDataError đọc cả `code` lẫn `cause.code`", () => {
    expect(pgStateOf({ cause: { code: "23514" } })).toBe("23514");
    expect(pgStateOf(new Error("x"))).toBeNull();
    expect([isDataError(pgErr("22001")), isDataError(pgErr("40001")), isDataError(null)]).toEqual([
      true,
      false,
      false,
    ]);
  });
});
