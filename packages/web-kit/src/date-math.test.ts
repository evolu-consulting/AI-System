// CR-125 · x8 · bộ chọn ngày: lưới tháng thứ Hai đầu tuần, tên tháng tiếng Việt, đọc dd/mm/yyyy, hiển thị bằng viDate (một nguồn).
import { describe, expect, it } from "bun:test";
import {
  addMonths,
  inRange,
  isoToVi,
  monthGrid,
  parseDate,
  todayVn,
  VI_MONTHS,
  VI_WEEKDAYS,
} from "./date-math";

describe("tên tháng / thứ", () => {
  it("12 tháng tiếng Việt, tuần bắt đầu T2 và kết thúc CN", () => {
    expect(VI_MONTHS).toHaveLength(12);
    expect(VI_MONTHS[8]).toBe("Tháng 9");
    expect(VI_WEEKDAYS[0]).toBe("T2");
    expect(VI_WEEKDAYS[6]).toBe("CN");
  });
});

describe("monthGrid", () => {
  it("tháng 9/2027 (1/9 là thứ Tư): hàng đầu bắt đầu 30/08 (T2) và có ô thứ Tư = 1", () => {
    const g = monthGrid(2027, 8);
    expect(g).toHaveLength(6);
    expect(g[0]?.[0]).toMatchObject({ iso: "2027-08-30", inMonth: false });
    expect(g[0]?.[2]).toMatchObject({ iso: "2027-09-01", day: 1, inMonth: true });
    expect(g.flat().filter((c) => c.inMonth)).toHaveLength(30);
  });
  it("tháng bắt đầu đúng thứ Hai không chừa ô thừa: 1/11/2027 là thứ Hai", () => {
    expect(monthGrid(2027, 10)[0]?.[0]).toMatchObject({ iso: "2027-11-01", inMonth: true });
  });
  it("tháng 2 năm nhuận có 29 ngày", () => {
    expect(
      monthGrid(2028, 1)
        .flat()
        .filter((c) => c.inMonth),
    ).toHaveLength(29);
  });
});

describe("parseDate", () => {
  it("dd/mm/yyyy (kể cả d/m, dấu - hoặc .) và ISO ⇒ ISO", () => {
    expect(parseDate("30/09/2027")).toBe("2027-09-30");
    expect(parseDate("3/9/2027")).toBe("2027-09-03");
    expect(parseDate("30-09-2027")).toBe("2027-09-30");
    expect(parseDate("2027-09-30")).toBe("2027-09-30");
  });
  it("ngày không có thật hoặc kiểu Mỹ sai ⇒ null (09/30 không phải ngày)", () => {
    expect(parseDate("09/30/2027")).toBeNull();
    expect(parseDate("31/04/2027")).toBeNull();
    expect(parseDate("29/02/2027")).toBeNull();
    expect(parseDate("abc")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
  it("hiển thị lại bằng viDate (một bộ định dạng) khớp phần đọc", () => {
    expect(isoToVi(parseDate("3/9/2027") ?? "")).toBe("03/09/2027");
  });
});

describe("addMonths · inRange · todayVn", () => {
  it("qua năm", () => {
    expect(addMonths(2027, 11, 1)).toEqual({ year: 2028, m0: 0 });
    expect(addMonths(2027, 0, -1)).toEqual({ year: 2026, m0: 11 });
  });
  it("min/max theo chuỗi ISO", () => {
    expect(inRange("2027-05-01", "2027-05-01", "2027-05-31")).toBe(true);
    expect(inRange("2027-06-01", undefined, "2027-05-31")).toBe(false);
  });
  it("hôm nay theo giờ Việt Nam", () => {
    expect(todayVn(new Date("2026-11-07T18:30:00.000Z"))).toBe("2026-11-08"); // 01:30 ngày sau
  });
});
