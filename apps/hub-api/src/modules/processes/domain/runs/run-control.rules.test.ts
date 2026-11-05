// CR-121 · R-1 · luật thuần điều khiển lượt chạy: vai × thao tác, trạng thái được phép.
import { describe, expect, it } from "bun:test";
import {
  alreadyStopped,
  canRerunRun,
  canRerunStep,
  canStop,
  rerunStepFeedback,
  roleAllows,
} from "./run-control.rules";

describe("CR-121 R-1 · run-control.rules", () => {
  it("vai: platform_admin mọi thao tác; tenant_admin không chạy lại bước; thành viên không gì", () => {
    expect(
      ["stop", "rerun_step", "rerun"].map((o) => roleAllows(o as never, "platform_admin")),
    ).toEqual([true, true, true]);
    expect(
      ["stop", "rerun_step", "rerun"].map((o) => roleAllows(o as never, "tenant_admin")),
    ).toEqual([true, false, true]);
    expect(["stop", "rerun_step", "rerun"].map((o) => roleAllows(o as never, "member"))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("Dừng: chỉ run chưa kết thúc; đã dừng ⇒ bấm lại cùng kết quả", () => {
    for (const s of [
      "running",
      "waiting_review",
      "waiting_answer",
      "needs_decision",
      "waiting_timer",
    ])
      expect(canStop(s as never)).toBe(true);
    for (const s of ["done", "cancelled", "failed", "expired"])
      expect(canStop(s as never)).toBe(false);
    expect(alreadyStopped("cancelled")).toBe(true);
    expect(alreadyStopped("done")).toBe(false);
  });

  it("Chạy lại bước: bước lỗi/xong, run đã dừng/hết hạn ⇒ không", () => {
    expect(canRerunStep("done", "done")).toBe(true);
    expect(canRerunStep("running", "needs_decision")).toBe(true);
    expect(canRerunStep("needs_decision", "failed")).toBe(true);
    expect(canRerunStep("running", "waiting_timer")).toBe(true);
    expect(canRerunStep("running", "running")).toBe(false);
    expect(canRerunStep("running", "queued")).toBe(false);
    expect(canRerunStep("running", "pending")).toBe(false);
    expect(canRerunStep("running", null)).toBe(false);
    expect(canRerunStep("cancelled", "done")).toBe(false);
    expect(canRerunStep("expired", "done")).toBe(false);
    // CR-121 F-3 · run gắn gói đã kết thúc ⇒ không; đang chạy ⇒ vẫn được.
    expect(canRerunStep("done", "done", true)).toBe(false);
    expect(canRerunStep("failed", "failed", true)).toBe(false);
    expect(canRerunStep("running", "needs_decision", true)).toBe(true);
  });

  it("Chạy lại cả lượt: chỉ run đã kết thúc, không gắn gói", () => {
    for (const s of ["done", "cancelled", "failed", "expired"])
      expect(canRerunRun(s as never, false)).toBe(true);
    expect(canRerunRun("running", false)).toBe(false);
    expect(canRerunRun("needs_decision", false)).toBe(false);
    expect(canRerunRun("cancelled", true)).toBe(false);
  });

  it("góp ý bước chạy lại có nhãn lý do (1..4000 ký tự)", () => {
    expect(rerunStepFeedback("bad_data")).toContain("Dữ liệu sai");
    expect(rerunStepFeedback("lạ")).toContain("Khác");
  });
});
