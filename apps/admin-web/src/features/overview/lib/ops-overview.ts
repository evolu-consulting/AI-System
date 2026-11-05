// CR-121 C-3b · hàm thuần của trang Tổng quan platform (bento): định dạng số, so với hôm qua, đường xu hướng, cột giờ, mục "Cần xử lý ngay", sức khoẻ.
import type { OpsOverview } from "@ai/contracts/hub-admin";

const INTL: Record<string, string> = { vi: "vi-VN", en: "en-US" };

/** Số thập phân theo ngôn ngữ (vi: `3,2`, en: `3.2`); `null` → `null` (nơi gọi hiện "—" + lý do). */
export function fmtDec(n: number | null, locale: string, digits = 1): string | null {
  if (n === null) return null;
  return new Intl.NumberFormat(INTL[locale] ?? locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n);
}

export type Delta = { dir: "up" | "down" | "flat" | "none"; diff: number };

/** So với hôm qua. Thiếu một trong hai số → `none` (chưa có số để so, không phải 0). */
export function deltaOf(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return { dir: "none", diff: 0 };
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return { dir: "flat", diff: 0 };
  return { dir: diff > 0 ? "up" : "down", diff: Math.abs(diff) };
}

/** Đường xu hướng 7 ngày → `points` của polyline (viewBox 100×28). Ít hơn 2 điểm có số → rỗng. Điểm `null` bị bỏ qua. */
export function sparkPoints(series: ReadonlyArray<number | null>): string {
  const pts = series
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return "";
  const vals = pts.map((p) => p.v);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const range = max - min || 1;
  const last = Math.max(series.length - 1, 1);
  return pts
    .map((p) => {
      const x = (p.i * 100) / last;
      const y = max === min ? 14 : 26 - ((p.v - min) / range) * 24;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export type HourBar = {
  hourStart: string;
  ok: number;
  error: number;
  okPct: number;
  errPct: number;
};

/** 24 cột giờ: chiều cao theo cột cao nhất; phần lỗi tối thiểu 6% khi có lỗi để nhìn thấy được. */
export function hourBars(hourly: OpsOverview["hourly"]): { bars: HourBar[]; total: number } {
  const max = Math.max(1, ...hourly.map((h) => h.ok + h.error));
  const bars = hourly.map((h) => {
    const t = h.ok + h.error;
    const height = t === 0 ? 0 : Math.max(4, Math.round((t / max) * 100));
    const errPct = h.error === 0 ? 0 : Math.max(6, Math.round((h.error / t) * 100));
    return { hourStart: h.hour_start, ok: h.ok, error: h.error, okPct: height, errPct };
  });
  return { bars, total: hourly.reduce((s, h) => s + h.ok + h.error, 0) };
}

/** Trang đích đã có trong admin-web. `/runs` chưa có ⇒ `null` (hiện số, không link; ghi "việc còn lại"). */
export type OpsLink = {
  to: "/tenants" | "/workflows" | "/system" | "/usage";
  search?: Record<string, string>;
};
const LINKABLE = new Set(["/tenants", "/workflows", "/system", "/usage"]);

export function resolveLink(link: string): OpsLink | null {
  const [path = ""] = link.split("?");
  if (!LINKABLE.has(path)) return null;
  // Bỏ `?filter=…`: trang đích chưa đọc bộ lọc nên link không hứa thứ không có (xem tasks.md "Việc còn lại").
  return { to: path as OpsLink["to"] };
}

export type AttentionKey = keyof OpsOverview["attention"];
export type AttentionRow = {
  key: AttentionKey;
  count: number;
  params: Record<string, number>;
  link: OpsLink | null;
};

const ATTENTION_ORDER: AttentionKey[] = [
  "stuck_runs",
  "unrouted_companies",
  "failing_ai_tools",
  "near_quota_companies",
  "half_configured",
];

/** Tách mục "Cần xử lý ngay": có việc (count > 0, theo thứ tự ưu tiên) và đã ổn (count = 0, hiện dấu tốt). */
export function attentionRows(a: OpsOverview["attention"]): {
  active: AttentionRow[];
  ok: AttentionKey[];
} {
  const rows = ATTENTION_ORDER.map((key) => {
    const item = a[key];
    const { count, link, ...rest } = item as { count: number; link: string } & Record<
      string,
      number
    >;
    return { key, count, params: { n: count, ...rest }, link: resolveLink(link) };
  });
  return {
    active: rows.filter((r) => r.count > 0),
    ok: rows.filter((r) => r.count === 0).map((r) => r.key),
  };
}

export type HealthLevel = "ok" | "warn" | "bad" | "none";
export type HealthKey = "queue" | "dify" | "db" | "deploy";
export type HealthTile = {
  key: HealthKey;
  level: HealthLevel;
  value: string;
  detail: Record<string, string | number>;
};

export const QUEUE_WARN_S = 300;
export const DIFY_WARN_PCT = 10;
export const DB_CONN_WARN = 0.8;

/** 4 ô sức khoẻ: giá trị hiển thị + mức (xanh/vàng/đỏ/chưa có). `t` nhận khoá đã dịch cho trường hợp "chưa có". */
export function healthTiles(h: OpsOverview["health"], locale: string, none: string): HealthTile[] {
  const lag = Math.round(h.queue.lag_s);
  const d = h.dify;
  const dbConn = h.db.max_connections > 0 ? h.db.connections / h.db.max_connections : 0;
  return [
    {
      key: "queue",
      level: lag > QUEUE_WARN_S ? "warn" : "ok",
      value: String(lag),
      detail: { lag, queued: h.queue.queued, oldest: Math.round(h.queue.oldest_wait_s) },
    },
    {
      key: "dify",
      level: d.error_rate_1h === null ? "none" : d.error_rate_1h > DIFY_WARN_PCT ? "warn" : "ok",
      value: fmtDec(d.error_rate_1h, locale) ?? none,
      detail: {
        rate: d.error_rate_1h ?? 0,
        errors: d.errors_24h,
        tool: d.top_failing_tool?.name ?? "",
      },
    },
    {
      key: "db",
      level: !h.db.ok ? "bad" : dbConn > DB_CONN_WARN ? "warn" : "ok",
      value: String(Math.round(h.db.slow_query_ms ?? h.db.ping_ms)),
      detail: { conn: h.db.connections, max: h.db.max_connections },
    },
    {
      key: "deploy",
      level: h.deploy.version ? "ok" : "none",
      value: h.deploy.version ?? none,
      detail: { version: h.deploy.version ?? "" },
    },
  ];
}
