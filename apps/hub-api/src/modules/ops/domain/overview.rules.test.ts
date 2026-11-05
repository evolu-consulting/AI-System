// CR-121 · cr121-c3a-overview-api · unit luật thuần của Tổng quan admin platform (tỷ lệ, p95 phút, chuỗi 7 ngày, 24 cột giờ, cache).
import { describe, expect, it } from "bun:test";
import {
  atWindow,
  cacheKey,
  dailySeries,
  fresh,
  halfConfigured,
  hourlyColumns,
  minutesOf,
  monthWindow,
  queueLagSeconds,
  ratePct,
  unroutedCompanies,
  usedPct,
} from "./overview.rules";

describe("overview.rules · tỷ lệ / p95 / hạn mức", () => {
  it("ratePct: 1 chữ số thập phân, mẫu số 0 ⇒ null (chưa có dữ liệu, không phải 0%)", () => {
    expect(ratePct(1, 3)).toBe(33.3);
    expect(ratePct(0, 10)).toBe(0);
    expect(ratePct(5, 5)).toBe(100);
    expect(ratePct(0, 0)).toBeNull();
  });
  it("minutesOf: giây thành phút 1 chữ số, null giữ nguyên", () => {
    expect(minutesOf(90)).toBe(1.5);
    expect(minutesOf(0)).toBe(0);
    expect(minutesOf(null)).toBeNull();
  });
  it("usedPct: không có hạn mức USD ⇒ null; có ⇒ % làm tròn", () => {
    expect(usedPct(12.5, 0)).toBeNull();
    expect(usedPct(12.5, 50)).toBe(25);
    expect(usedPct(60, 50)).toBe(120);
  });
  it("queueLagSeconds: lớn hơn của (chờ lâu nhất, hẹn giờ quá hạn), làm tròn, null = 0", () => {
    expect(queueLagSeconds(null, null)).toBe(0);
    expect(queueLagSeconds(4.4, 90.6)).toBe(91);
    expect(queueLagSeconds(30, null)).toBe(30);
  });
});

describe("overview.rules · chuỗi 7 ngày / 24 giờ", () => {
  it("dailySeries: CŨ → MỚI, k=0 ở cuối, thiếu ⇒ empty, k ngoài khoảng bị bỏ", () => {
    const s = dailySeries(
      [
        { k: 0, n: 9 },
        { k: 2, n: 4 },
        { k: 6, n: 1 },
        { k: 7, n: 99 },
        { k: -1, n: 77 },
      ],
      (r) => r.n,
      0,
    );
    expect(s).toEqual([1, 0, 0, 0, 4, 0, 9]);
    expect(atWindow(s, 0)).toBe(9);
    expect(atWindow(s, 1)).toBe(0);
    expect(atWindow(s, 2)).toBe(4);
  });
  it("hourlyColumns: đúng 24 cột, cột cuối = giờ gần nhất, hour_start là đầu cửa sổ giờ", () => {
    const now = new Date("2026-11-05T10:30:00.000Z");
    const cols = hourlyColumns(
      [
        { h: 0, ok: 5, err: 1 },
        { h: 23, ok: 2, err: 0 },
        { h: 24, ok: 9, err: 9 },
      ],
      now,
    );
    expect(cols).toHaveLength(24);
    expect(cols[23]).toEqual({ hour_start: "2026-11-05T09:30:00.000Z", ok: 5, error: 1 });
    expect(cols[0]).toEqual({ hour_start: "2026-11-04T10:30:00.000Z", ok: 2, error: 0 });
    expect(cols.reduce((a, c) => a + c.ok + c.error, 0)).toBe(8);
  });
  it("monthWindow: [đầu tháng, đầu tháng sau) theo UTC, qua năm", () => {
    const w = monthWindow(new Date("2026-12-31T23:59:59Z"));
    expect(w.from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("overview.rules · từ kết quả check flow_coverage", () => {
  it("unroutedCompanies: tên công ty khác nhau; danh sách bị cắt ⇒ cận trên gap_count; không có ⇒ 0", () => {
    expect(unroutedCompanies(null)).toBe(0);
    expect(unroutedCompanies({ gap_count: 0, gaps: [] })).toBe(0);
    expect(
      unroutedCompanies({
        gap_count: 3,
        gaps: [{ tenant: "A" }, { tenant: "A" }, { tenant: "B" }],
      }),
    ).toBe(2);
    expect(unroutedCompanies({ gap_count: 50, gaps: [{ tenant: "A" }] })).toBe(50);
  });
  it("halfConfigured: hợp (không trùng) công ty còn lượt duyệt không có quy trình + quy trình không chạy được", () => {
    expect(halfConfigured(null)).toBe(0);
    expect(halfConfigured({ unrouted: ["A"], broken: ["A", "B"] })).toBe(2);
    expect(halfConfigured({})).toBe(0);
  });
});

describe("overview.rules · cache 60 giây", () => {
  it("fresh: còn hạn khi tuổi < ttl; hết hạn / đồng hồ lùi / chưa có ⇒ false", () => {
    const c = { at: 1_000, value: 1 };
    expect(fresh(c, 1_000, 60_000)).toBe(true);
    expect(fresh(c, 60_999, 60_000)).toBe(true);
    expect(fresh(c, 61_000, 60_000)).toBe(false);
    expect(fresh(c, 500, 60_000)).toBe(false);
    expect(fresh(undefined, 1_000, 60_000)).toBe(false);
  });
  it("cacheKey: cùng tham số ⇒ cùng khoá", () => {
    expect(cacheKey({ stuck_hours: 4, quota_pct: 80 })).toBe("4:80");
    expect(cacheKey({ stuck_hours: 6, quota_pct: 80 })).not.toBe("4:80");
  });
});
