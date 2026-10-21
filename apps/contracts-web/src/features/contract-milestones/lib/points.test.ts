// GAP-D2 · #15: điểm uy tín (+/−) mỗi mốc ở dòng thời gian (mockup `msDelta`).
import { describe, expect, it } from "bun:test";
import { milestonePoints, signed } from "./points";

const m = (o: Partial<Parameters<typeof milestonePoints>[0]> = {}) =>
  milestonePoints({
    kind: "delivery",
    owner: "partner",
    confirmed: true,
    due_date: "2026-10-10",
    done_at: "2026-10-10",
    fault: null,
    ...o,
  });

describe("điểm của mốc", () => {
  it("đúng/sớm hạn ⇒ cộng theo loại mốc", () => {
    expect(m()).toEqual({ kind: "pts", value: 2 });
    expect(m({ done_at: "2026-10-08" })).toEqual({ kind: "pts", value: 2 });
    expect(m({ kind: "serial" })).toEqual({ kind: "pts", value: 1 });
  });
  it("trễ do đối tác ⇒ trừ, thêm mỗi ngày quá 3 ngày ân hạn, sàn −15", () => {
    expect(m({ done_at: "2026-10-13", fault: "partner" })).toEqual({ kind: "pts", value: -6 });
    expect(m({ done_at: "2026-10-15", fault: "partner" })).toEqual({ kind: "pts", value: -8 });
    expect(m({ done_at: "2026-12-30", fault: "partner" })).toEqual({ kind: "pts", value: -15 });
  });
  it("trễ do mình ⇒ 0; chưa rõ lỗi ⇒ chưa tính; mốc của mình ⇒ uy tín của mình", () => {
    expect(m({ done_at: "2026-10-15", fault: "ours" })).toEqual({ kind: "pts", value: 0 });
    expect(m({ done_at: "2026-10-15", fault: "unknown" })).toEqual({ kind: "pending" });
    expect(m({ owner: "ours" })).toEqual({ kind: "mine" });
  });
  it("chưa xác nhận hoặc loại không góp điểm ⇒ không hiện", () => {
    expect(m({ confirmed: false, done_at: null })).toBeNull();
    expect(m({ kind: "renewal" })).toBeNull();
  });
  it("định dạng dấu", () => {
    expect([signed(2), signed(-6), signed(0)]).toEqual(["+2", "−6", "0"]);
  });
});
