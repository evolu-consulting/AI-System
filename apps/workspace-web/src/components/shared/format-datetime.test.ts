// CR-125 · x1 · MỘT bộ định dạng ngày cho cả app Sổ Hợp Tác: dd/mm/yyyy (không mm/dd theo máy), giờ Việt Nam.
import { describe, expect, it } from "bun:test";
import { viDate, viDateTime } from "./format";

describe("viDate / viDateTime", () => {
  it("ngày ISO ⇒ dd/mm/yyyy (30/09 chứ không 09/30)", () => {
    expect(viDate("2031-09-30")).toBe("30/09/2031");
    expect(viDate("2031-09-30T17:30:00.000Z")).toBe("01/10/2031"); // 00:30 giờ VN ngày sau
  });
  it("ngày giờ ⇒ dd/mm/yyyy HH:mm giờ VN; rỗng/hỏng ⇒ —", () => {
    expect(viDateTime("2026-09-30T05:30:00.000Z")).toBe("30/09/2026 12:30");
    expect(viDateTime(null)).toBe("—");
    expect(viDateTime("không phải ngày")).toBe("—");
  });
});
