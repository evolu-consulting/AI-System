// CR-125 · x1 · số "Chờ bạn" = ký + duyệt từ một đọc; số đỏ thanh dưới.
import { describe, expect, it } from "bun:test";
import { signTitle, waitingBadge, waitingOf } from "./waiting";

const sign = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    contract_id: `c${i}`,
    contract_number: null,
    contract_title: null,
    since: "2026-11-07T00:00:00.000Z",
  }));
const appr = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    task_id: `t${i}`,
    contract_id: `a${i}`,
    contract_number: null,
    contract_title: null,
    stage_name: "Duyệt",
    due_at: null,
    escalated: false,
  }));

describe("waitingOf", () => {
  it("2 ký + 1 duyệt ⇒ tổng 3", () => {
    expect(waitingOf({ signing: sign(2), approvals: appr(1) })).toEqual({
      sign: 2,
      approve: 1,
      total: 3,
    });
  });
  it("thiếu trường / chưa tải ⇒ 0", () => {
    expect(waitingOf({})).toEqual({ sign: 0, approve: 0, total: 0 });
    expect(waitingOf(undefined).total).toBe(0);
  });
});
describe("waitingBadge", () => {
  it("0 ⇒ ẩn, 1..99 ⇒ số, trên 99 ⇒ 99+", () => {
    expect([waitingBadge(0), waitingBadge(3), waitingBadge(100)]).toEqual([null, "3", "99+"]);
  });
});
describe("signTitle", () => {
  it("số · tên; thiếu ⇒ rỗng", () => {
    expect(signTitle({ contract_number: "HD-1", contract_title: "Mua" })).toBe("HD-1 · Mua");
    expect(signTitle({ contract_number: null, contract_title: null })).toBe("");
  });
});
