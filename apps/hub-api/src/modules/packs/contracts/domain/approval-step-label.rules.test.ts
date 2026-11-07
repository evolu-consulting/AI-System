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

describe("CR-123 u10 · nhãn bước hiện tại của HĐ trong danh sách", () => {
  it("bước duyệt đang mở ⇒ Chờ <tên bước>", () => {
    expect(
      stepLabelOf(
        v("waiting_review", [s(0, "Soạn", "passed"), s(1, "Trưởng phòng duyệt", "open")]),
      ),
    ).toBe("Chờ Trưởng phòng duyệt");
  });
  it("Ký số đang chờ (cụm đã gộp một bước) ⇒ Chờ <người ký> ký, không biết người ký ⇒ Chờ ký", () => {
    const steps = (m: { outcome: string; signer?: string }) => [
      s(0, "Soạn", "passed"),
      s(1, "Ký số", "running", m),
    ];
    expect(stepLabelOf(v("waiting_timer", steps({ outcome: "waiting", signer: "Giám đốc" })))).toBe(
      "Chờ Giám đốc ký",
    );
    expect(stepLabelOf(v("waiting_timer", steps({ outcome: "waiting" })))).toBe("Chờ ký");
  });
  it("bước soạn mở và chưa gửi ⇒ Chờ gửi duyệt", () => {
    expect(
      stepLabelOf(v("waiting_review", [s(0, "Xác nhận", "open"), s(1, "Duyệt", "pending")])),
    ).toBe("Chờ gửi duyệt");
  });
  it("CR-124 · run của event flow (from_run): bước duyệt đầu đang mở ⇒ Chờ <tên bước>, không phải Chờ gửi duyệt", () => {
    const run = v("waiting_review", [
      s(0, "Giám đốc duyệt", "open"),
      s(1, "Gửi đối tác", "pending"),
    ]);
    expect(stepLabelOf(run, true)).toBe("Chờ Giám đốc duyệt");
    expect(stepLabelOf(run)).toBe("Chờ gửi duyệt");
  });
  it("CR-123 · u10b · kết cục cuối đọc rõ: Đã duyệt", () => {
    expect(stepLabelOf(v("done", [s(0, "A", "passed"), s(1, "B", "passed")]))).toBe("Đã duyệt");
  });
  it("CR-123 · u10b · kết cục cuối đọc rõ: Từ chối (run xong hay đã huỷ đều là Từ chối khi có bước bị từ chối)", () => {
    expect(stepLabelOf(v("done", [s(0, "A", "passed"), s(1, "B", "rejected")]))).toBe("Từ chối");
    expect(stepLabelOf(v("cancelled", [s(0, "A", "passed"), s(1, "B", "rejected")]))).toBe(
      "Từ chối",
    );
  });
  it("CR-123 · u10b · kết cục cuối đọc rõ: Đã huỷ", () => {
    expect(stepLabelOf(v("cancelled", [s(0, "A", "passed"), s(1, "B", "pending")]))).toBe("Đã huỷ");
    expect(stepLabelOf(v("cancelled", []))).toBe("Đã huỷ");
  });
  it("CR-123 · u10b · kết cục cuối đọc rõ: Trả lại — chờ sửa", () => {
    expect(
      stepLabelOf(v("waiting_review", [s(0, "Xác nhận", "open"), s(1, "Duyệt", "returned")])),
    ).toBe("Trả lại — chờ sửa");
  });
  it("lỗi ⇒ Cần xử lý; không có run ⇒ null", () => {
    expect(stepLabelOf(v("needs_decision", []))).toBe("Cần xử lý");
    expect(stepLabelOf(null)).toBeNull();
  });
});
