// ADM-FR-42 · M4-R03 · hình học cột ngày cho DailyBars (hàm thuần, test được). Không phụ thuộc DOM.
export type DayInput = {
  date: string;
  /** Tổng số thu trong ngày (chuỗi thập phân của API hoặc số). */
  total: string | number;
  /** Phần vượt quota trong tổng (≤ total). */
  over: string | number;
};

export type Bar = {
  date: string;
  total: number;
  over: number;
  inQuota: number;
  x: number;
  width: number;
  /** Chiều cao (px trong viewBox) của phần trong quota / phần vượt. */
  hIn: number;
  hOver: number;
  /** Toạ độ y đáy phần trong quota (phần vượt nằm ngay trên). */
  yIn: number;
  yOver: number;
};

export type BarsLayout = {
  bars: Bar[];
  width: number;
  height: number;
  /** Ngày có tổng cao nhất (null khi không có dữ liệu hoặc mọi ngày bằng 0). */
  peak: { date: string; total: number } | null;
  sum: number;
};

const num = (v: string | number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Cột bằng nhau, khoảng cách 20% bề rộng ô; chiều cao tỉ lệ với ngày cao nhất; ngày > 0 luôn ≥ 1 px. */
export function layoutBars(days: readonly DayInput[], width: number, height: number): BarsLayout {
  const rows = days.map((d) => {
    const total = num(d.total);
    return { date: d.date, total, over: Math.min(num(d.over), total) };
  });
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);
  const slot = rows.length > 0 ? width / rows.length : 0;
  const bw = slot * 0.8;
  let peak: BarsLayout["peak"] = null;
  let sum = 0;
  const bars = rows.map((r, i) => {
    sum += r.total;
    if (r.total > 0 && (peak === null || r.total > peak.total))
      peak = { date: r.date, total: r.total };
    const h = max > 0 && r.total > 0 ? Math.max(1, (r.total / max) * height) : 0;
    const hOver = r.total > 0 ? h * (r.over / r.total) : 0;
    const hIn = h - hOver;
    return {
      date: r.date,
      total: r.total,
      over: r.over,
      inQuota: r.total - r.over,
      x: i * slot + (slot - bw) / 2,
      width: bw,
      hIn,
      hOver,
      yIn: height - hIn,
      yOver: height - hIn - hOver,
    };
  });
  return { bars, width, height, peak, sum };
}
