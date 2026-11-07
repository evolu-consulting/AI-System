// CR-123 · u10b · dòng danh sách HĐ sau "Kết thúc · Đã duyệt": "Đã duyệt · Đang hiệu lực"; các kết cục khác đọc nguyên nhãn của helper.
import { describe, expect, it } from "bun:test";
import { approvedLabel } from "./row-view";

describe("approvedLabel", () => {
  it("lượt duyệt Đã duyệt ⇒ ghép với trạng thái HĐ", () => {
    expect(approvedLabel("Đã duyệt", "Đang hiệu lực")).toBe("Đã duyệt · Đang hiệu lực");
  });
  it("Từ chối · Đã huỷ · Trả lại — chờ sửa · đang chờ · vắng ⇒ không ghép (giữ nhãn khác)", () => {
    for (const l of ["Từ chối", "Đã huỷ", "Trả lại — chờ sửa", "Chờ Giám đốc ký", null, undefined])
      expect(approvedLabel(l, "Đang hiệu lực")).toBeNull();
  });
});
