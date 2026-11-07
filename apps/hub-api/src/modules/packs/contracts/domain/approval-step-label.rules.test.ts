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
  it("bước soạn mở: chưa gửi ⇒ Chờ gửi duyệt; sau khi bị trả lại ⇒ Bị trả lại", () => {
    expect(
      stepLabelOf(v("waiting_review", [s(0, "Xác nhận", "open"), s(1, "Duyệt", "pending")])),
    ).toBe("Chờ gửi duyệt");
    expect(
      stepLabelOf(v("waiting_review", [s(0, "Xác nhận", "open"), s(1, "Duyệt", "returned")])),
    ).toBe("Bị trả lại");
  });
  it("CR-124 · run của event flow (from_run): bước duyệt đầu đang mở ⇒ Chờ <tên bước>, không phải Chờ gửi duyệt", () => {
    const run = v("waiting_review", [
      s(0, "Giám đốc duyệt", "open"),
      s(1, "Gửi đối tác", "pending"),
    ]);
    expect(stepLabelOf(run, true)).toBe("Chờ Giám đốc duyệt");
    expect(stepLabelOf(run)).toBe("Chờ gửi duyệt");
  });
  it("run xong ⇒ Đã duyệt / Bị từ chối; huỷ / lỗi ⇒ nhãn riêng; không có run ⇒ null", () => {
    expect(stepLabelOf(v("done", [s(0, "A", "passed")]))).toBe("Đã duyệt");
    expect(stepLabelOf(v("done", [s(0, "A", "passed"), s(1, "B", "rejected")]))).toBe("Bị từ chối");
    expect(stepLabelOf(v("cancelled", []))).toBe("Đã huỷ");
    expect(stepLabelOf(v("needs_decision", []))).toBe("Cần xử lý");
    expect(stepLabelOf(null)).toBeNull();
  });
});
