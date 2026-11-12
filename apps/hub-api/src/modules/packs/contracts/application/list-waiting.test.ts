// CR-127 K2a-1 · BR-05: `waiting` suy từ lượt đã đọc theo lô — không thêm nguồn dữ liệu.
import { describe, expect, it } from "bun:test";
import { waitingOf } from "./list-waiting";

const step = (o: Record<string, unknown>) => ({
  idx: 1,
  name: "Trưởng phòng",
  status: "open",
  due_at: "2026-11-12T00:00:00.000Z",
  ...o,
});

describe("waitingOf", () => {
  it("bước duyệt đang mở ⇒ tên bước + hạn", () => {
    expect(waitingOf({ steps: [step({})] }, { code: "waiting_step" })).toEqual({
      step: "Trưởng phòng",
      who: null,
      due_at: "2026-11-12T00:00:00.000Z",
    });
  });
  it("bước Ký số ⇒ người ký", () => {
    const s = step({ name: "Ký số", module: { outcome: "waiting", signer: " Giám đốc " } });
    expect(waitingOf({ steps: [s] }, { code: "waiting_sign" })?.who).toBe("Giám đốc");
  });
  it("trạng thái khác (soạn lại, xong, huỷ) hoặc không có lượt ⇒ null", () => {
    expect(waitingOf({ steps: [step({})] }, { code: "approved" })).toBeNull();
    expect(waitingOf({ steps: [step({})] }, { code: "returned" })).toBeNull();
    expect(waitingOf({ steps: [step({})] }, null)).toBeNull();
    expect(waitingOf(null, { code: "waiting_step" })).toBeNull();
    expect(waitingOf({ steps: [step({ status: "passed" })] }, { code: "waiting_step" })).toBeNull();
  });
});
