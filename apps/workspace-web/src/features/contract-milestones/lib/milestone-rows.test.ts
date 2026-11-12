import { describe, expect, test } from "bun:test";
import type { Milestone, Obligation } from "@ai/contracts/pack-contracts";
import { claimOf, pctOf, progressStats, type RowOpts, rowView } from "./milestone-rows";

const ms = (o: Partial<Milestone>): Milestone =>
  ({
    id: "m1",
    contract_id: "c",
    kind: "delivery",
    title: "Giao đợt 2",
    seq: 2,
    due_date: "2026-11-20",
    owner: "ours",
    qty: 650,
    amount: null,
    amount_effective: null,
    status: "open",
    confirmed: false,
    done_at: null,
    fault: null,
    postponed_to: null,
    source: "ai",
    ...o,
  }) as Milestone;
const ob = (task: Obligation["task"]): Obligation => ({ task }) as Obligation;
const opt: RowOpts = {
  today: "2026-11-10",
  nextId: "m1",
  write: true,
  held: false,
  superseded: false,
  userId: "me",
  admin: false,
};
const unclaimed = ob({ task_id: "t", state: "unclaimed", claimed_by: null });
const mine = ob({ task_id: "t", state: "claimed", claimed_by: "me" });
const other = ob({ task_id: "t", state: "claimed", claimed_by: "u2" });

describe("CR-127 U5 · mốc thực hiện", () => {
  test("claimOf: không việc / chưa ai nhận / mình giữ / người khác giữ", () => {
    expect(claimOf(undefined, "me").kind).toBe("none");
    expect(claimOf(unclaimed, "me").kind).toBe("unclaimed");
    expect(claimOf(mine, "me").kind).toBe("mine");
    expect(claimOf(other, "me")).toMatchObject({ kind: "other", by: "u2" });
  });
  test("chưa ai nhận ⇒ phải Nhận việc trước, chưa Xác nhận được", () => {
    expect(rowView(ms({}), unclaimed, opt)).toMatchObject({
      canClaim: true,
      canConfirm: false,
      why: "unclaimed",
    });
  });
  test("mình đã nhận ⇒ Xác nhận + Trả về nhóm", () => {
    expect(rowView(ms({}), mine, opt)).toMatchObject({
      canConfirm: true,
      canRelease: true,
      canClaim: false,
      why: null,
    });
  });
  test("người khác đang xử lý ⇒ chỉ xem; quản trị vẫn xác nhận được", () => {
    expect(rowView(ms({}), other, opt)).toMatchObject({ canConfirm: false, why: "other" });
    expect(rowView(ms({}), other, { ...opt, admin: true }).canConfirm).toBe(true);
  });
  test("mốc không có việc nhóm ⇒ xác nhận thẳng", () => {
    expect(rowView(ms({}), undefined, opt).canConfirm).toBe(true);
  });
  test("tạm khoá ⇒ chặn giao/nhận mốc, vẫn ghi được thu tiền", () => {
    expect(rowView(ms({}), undefined, { ...opt, held: true })).toMatchObject({
      canConfirm: false,
      why: "hold",
    });
    expect(rowView(ms({ kind: "collect" }), undefined, { ...opt, held: true }).canConfirm).toBe(
      true,
    );
  });
  test("mốc đã xong / đã huỷ / bản bị thay ⇒ không nút", () => {
    const done = ms({ status: "done", confirmed: true, done_at: "2026-11-09" });
    expect(rowView(done, undefined, opt).canConfirm).toBe(false);
    expect(rowView(ms({ status: "cancelled" }), undefined, opt).state).toBe("cancelled");
    expect(rowView(ms({}), undefined, { ...opt, superseded: true })).toMatchObject({
      canConfirm: false,
      why: "super",
    });
  });
  test("trạng thái trễ: xong sau hạn ⇒ late; quá hạn chưa xong ⇒ over", () => {
    const lateDone = ms({ status: "done", confirmed: true, done_at: "2026-11-22" });
    expect(rowView(lateDone, undefined, opt).state).toBe("late");
    expect(rowView(ms({ due_date: "2026-11-01" }), undefined, { ...opt, nextId: null }).state).toBe(
      "over",
    );
  });
  test("progressStats: giao 650/1300, thu 195/650", () => {
    const list = [
      ms({ id: "a", status: "done", qty: 650 }),
      ms({ id: "b", qty: 650 }),
      ms({ id: "c", kind: "collect", status: "done", amount_effective: 195 }),
      ms({ id: "d", kind: "collect", amount_effective: 455 }),
    ];
    expect(progressStats(list)).toMatchObject({
      qtyDone: 650,
      qtyTotal: 1300,
      deliveriesLeft: 1,
      moneyDone: 195,
      moneyTotal: 650,
      collectsLeft: 1,
    });
    expect(pctOf(650, 1300)).toBe(50);
    expect(pctOf(1, 0)).toBe(0);
  });
});
