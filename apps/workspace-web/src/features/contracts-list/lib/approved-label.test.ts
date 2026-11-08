// CR-123 · u10b · dòng danh sách HĐ sau "Kết thúc · Đã duyệt": "Đã duyệt · Đang hiệu lực"; các kết cục khác đọc nguyên nhãn của helper.
// CR-125 · SA H4: so sánh theo MÃ bước (hub không còn trả chữ tiếng Việt).
import { describe, expect, it } from "bun:test";
import { approvedLabel, stepKey } from "./row-view";

describe("approvedLabel", () => {
  it("mã approved ⇒ ghép với trạng thái HĐ", () => {
    expect(approvedLabel({ code: "approved" }, "Đã duyệt", "Đang hiệu lực")).toBe(
      "Đã duyệt · Đang hiệu lực",
    );
  });
  it("rejected · cancelled · returned · đang chờ · vắng ⇒ không ghép (giữ nhãn khác)", () => {
    for (const s of [
      { code: "rejected" as const },
      { code: "cancelled" as const },
      { code: "returned" as const },
      { code: "waiting_sign" as const, who: "Giám đốc" },
      null,
      undefined,
    ])
      expect(approvedLabel(s, "Đã duyệt", "Đang hiệu lực")).toBeNull();
  });
  it("khoá i18n theo mã; Ký số có tên người ký dùng khoá riêng", () => {
    expect(stepKey({ code: "waiting_step", name: "Duyệt" })).toBe(
      "contracts.list.step.waiting_step",
    );
    expect(stepKey({ code: "waiting_sign", who: "Hùng" })).toBe(
      "contracts.list.step.waiting_sign_who",
    );
    expect(stepKey({ code: "waiting_sign" })).toBe("contracts.list.step.waiting_sign");
  });
});
