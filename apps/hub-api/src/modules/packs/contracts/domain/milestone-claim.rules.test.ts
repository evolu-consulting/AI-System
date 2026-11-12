// CR-127 · X5 · luật «đang xử lý» của mốc (spec §5.9, BR-40).
import { describe, expect, it } from "bun:test";
import { claimVerdict, type MilestoneHolder } from "./milestone-claim.rules";

const h = (claimedBy: string | null): MilestoneHolder => ({
  taskId: "t1",
  claimedBy,
  assigneeIds: ["a", "b"],
});

describe("claimVerdict", () => {
  it("không có việc mở ⇒ đường cũ (cho phép)", () => {
    expect(claimVerdict([], "a", false)).toEqual({ ok: true });
  });
  it("người đã nhận được ghi", () => {
    expect(claimVerdict([h("a")], "a", false)).toEqual({ ok: true });
  });
  it("người khác khi đã có người nhận ⇒ claimed kèm người giữ", () => {
    expect(claimVerdict([h("a")], "b", false)).toEqual({ ok: false, kind: "claimed", by: "a" });
  });
  it("chưa ai nhận ⇒ phải Nhận việc trước", () => {
    expect(claimVerdict([h(null)], "b", false)).toEqual({ ok: false, kind: "not_claimed" });
  });
  it("người phụ trách / quản trị công ty luôn được", () => {
    expect(claimVerdict([h("a")], "x", true)).toEqual({ ok: true });
    expect(claimVerdict([h(null)], "x", true)).toEqual({ ok: true });
  });
});
