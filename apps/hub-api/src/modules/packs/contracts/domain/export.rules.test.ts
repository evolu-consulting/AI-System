// CR-127 K2a-2: nhãn "Trạng thái" xuất Excel theo 4 trạng thái + extract_state + effect.
import { describe, expect, it } from "bun:test";
import { statusLabelOf } from "./export.rules";

describe("statusLabelOf", () => {
  it("nháp: đang đọc / đọc lỗi theo extract_state, còn lại Bản nháp", () => {
    expect(statusLabelOf({ status: "draft", extractState: "reading" })).toBe("Đang đọc");
    expect(statusLabelOf({ status: "draft", extractState: "failed" })).toBe("Đọc lỗi");
    expect(statusLabelOf({ status: "draft", extractState: "ready" })).toBe("Bản nháp");
  });
  it("processing / reject", () => {
    expect(statusLabelOf({ status: "processing" })).toBe("Đang duyệt");
    expect(statusLabelOf({ status: "reject" })).toBe("Bị từ chối");
  });
  it("done: theo hiệu lực; chưa có effect ⇒ Đã xác nhận", () => {
    expect(statusLabelOf({ status: "done", effect: "expiring" })).toBe("Sắp hết hạn");
    expect(statusLabelOf({ status: "done", effect: "renewed" })).toBe("Đã gia hạn");
    expect(statusLabelOf({ status: "done", effect: "terminated" })).toBe("Đã chấm dứt");
    expect(statusLabelOf({ status: "done", effect: "not_started" })).toBe("Chưa hiệu lực");
    expect(statusLabelOf({ status: "done" })).toBe("Đã xác nhận");
  });
});
