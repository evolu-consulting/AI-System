import { describe, expect, it } from "bun:test";
import { type StepLabelView, stepLabelOf } from "./approval-step-label.rules";

const v = (status: string, steps: StepLabelView["steps"]): StepLabelView => ({ status, steps });
const s = (
  idx: number,
  name: string,
  status: string,
  module?: { outcome: string; signer?: string },
) => ({
  idx,
  name,
  status,
  module,
});

// CR-125 · SA H4: máy chủ trả MÃ trạng thái (web dịch qua i18n), không trả chữ tiếng Việt.
describe("CR-123 u10 · mã bước hiện tại của HĐ trong danh sách", () => {
  it("bước duyệt đang mở ⇒ waiting_step + tên bước", () => {
    expect(
      stepLabelOf(
        v("waiting_review", [s(0, "Soạn", "passed"), s(1, "Trưởng phòng duyệt", "open")]),
      ),
    ).toEqual({ code: "waiting_step", name: "Trưởng phòng duyệt" });
  });
  it("Ký số đang chờ ⇒ waiting_sign + người ký; không biết người ký ⇒ waiting_sign", () => {
    const steps = (m: { outcome: string; signer?: string }) => [
      s(0, "Soạn", "passed"),
      s(1, "Ký số", "running", m),
    ];
    expect(
      stepLabelOf(v("waiting_timer", steps({ outcome: "waiting", signer: "Giám đốc" }))),
    ).toEqual({ code: "waiting_sign", who: "Giám đốc" });
    expect(stepLabelOf(v("waiting_timer", steps({ outcome: "waiting" })))).toEqual({
      code: "waiting_sign",
    });
  });
  it("bước soạn mở và chưa gửi ⇒ waiting_draft", () => {
    expect(
      stepLabelOf(v("waiting_review", [s(0, "Xác nhận", "open"), s(1, "Duyệt", "pending")])),
    ).toEqual({ code: "waiting_draft" });
  });
  it("CR-124 · run của event flow (from_run): bước duyệt đầu đang mở ⇒ waiting_step, không phải waiting_draft", () => {
    const run = v("waiting_review", [
      s(0, "Giám đốc duyệt", "open"),
      s(1, "Gửi đối tác", "pending"),
    ]);
    expect(stepLabelOf(run, true)).toEqual({ code: "waiting_step", name: "Giám đốc duyệt" });
    expect(stepLabelOf(run)).toEqual({ code: "waiting_draft" });
  });
  it("kết cục cuối: approved", () => {
    expect(stepLabelOf(v("done", [s(0, "A", "passed"), s(1, "B", "passed")]))).toEqual({
      code: "approved",
    });
  });
  it("kết cục cuối: rejected (run xong hay đã huỷ đều là rejected khi có bước bị từ chối)", () => {
    expect(stepLabelOf(v("done", [s(0, "A", "passed"), s(1, "B", "rejected")]))).toEqual({
      code: "rejected",
    });
    expect(stepLabelOf(v("cancelled", [s(0, "A", "passed"), s(1, "B", "rejected")]))).toEqual({
      code: "rejected",
    });
  });
  it("kết cục cuối: cancelled", () => {
    expect(stepLabelOf(v("cancelled", [s(0, "A", "passed"), s(1, "B", "pending")]))).toEqual({
      code: "cancelled",
    });
    expect(stepLabelOf(v("cancelled", []))).toEqual({ code: "cancelled" });
  });
  it("kết cục cuối: returned", () => {
    expect(
      stepLabelOf(v("waiting_review", [s(0, "Xác nhận", "open"), s(1, "Duyệt", "returned")])),
    ).toEqual({ code: "returned" });
  });
  it("lỗi ⇒ attention; không có run ⇒ null", () => {
    expect(stepLabelOf(v("needs_decision", []))).toEqual({ code: "attention" });
    expect(stepLabelOf(null)).toBeNull();
  });
});
