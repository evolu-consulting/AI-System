// CR-121 · cr121-c3a-overview-api · contract `GET /ops/overview` — "Tổng quan admin platform" (chỉ platform_admin).
// Mọi chuỗi (`series`) có đúng 7 phần tử, CŨ → MỚI: phần tử [6] = 24 giờ gần nhất, [5] = 24 giờ trước đó… (cửa sổ trượt theo
// `generated_at`, không theo lịch). `hourly` có đúng 24 cột cũ → mới (cột [23] = giờ gần nhất). Tỷ lệ là phần trăm 1 chữ số thập phân.
import { z } from "zod";

export const OVERVIEW_SERIES_DAYS = 7;
export const OVERVIEW_HOURS = 24;
export const OVERVIEW_DEFAULT_STUCK_HOURS = 4;
export const OVERVIEW_STUCK_HOURS_RANGE = { min: 1, max: 72 } as const;
export const OVERVIEW_DEFAULT_QUOTA_PCT = 80;
export const OVERVIEW_QUOTA_PCT_RANGE = { min: 50, max: 100 } as const;
/** Công cụ AI "lỗi liên tục" = N lần chạy gần nhất (trong 24 giờ) đều lỗi. */
export const OVERVIEW_AI_TOOL_STREAK = 3;
export const OVERVIEW_CACHE_TTL_S = 60;

const Count = z.number().int().min(0);
const Pct = z.number().min(0);
const Series = <T extends z.ZodType>(t: T) => z.array(t).length(OVERVIEW_SERIES_DAYS);

/** Cách tính p95: trừ thời gian chờ người duyệt (mặc định) hay tổng thời gian từ gửi đến xong. */
export const OVERVIEW_P95_BASES = ["excluding_review_wait", "total_elapsed"] as const;

/** Query lỏng (tham số lạ bị bỏ); giá trị sai/ngoài khoảng ⇒ route dùng mặc định (không 4xx — màn hình chủ không được hỏng vì tham số). */
export const OpsOverviewQuerySchema = z.object({
  stuck_hours: z.coerce
    .number()
    .int()
    .min(OVERVIEW_STUCK_HOURS_RANGE.min)
    .max(OVERVIEW_STUCK_HOURS_RANGE.max)
    .default(OVERVIEW_DEFAULT_STUCK_HOURS),
  quota_pct: z.coerce
    .number()
    .int()
    .min(OVERVIEW_QUOTA_PCT_RANGE.min)
    .max(OVERVIEW_QUOTA_PCT_RANGE.max)
    .default(OVERVIEW_DEFAULT_QUOTA_PCT),
});
export type OpsOverviewQuery = z.infer<typeof OpsOverviewQuerySchema>;

export const OpsOverviewSchema = z.strictObject({
  generated_at: z.string(),
  cache_ttl_s: z.literal(OVERVIEW_CACHE_TTL_S),
  params: z.strictObject({ stuck_hours: z.number().int(), quota_pct: z.number().int() }),
  kpi: z.strictObject({
    /** Lượt chạy quy trình bắt đầu trong 24 giờ (mọi công ty khách) + trạng thái hiện tại. */
    runs: z.strictObject({
      value: Count,
      yesterday: Count,
      running: Count,
      failed: Count,
      needs_decision: Count,
      series: Series(Count),
    }),
    /** (lỗi + hết hạn) / (xong + lỗi + hết hạn) của lượt kết thúc trong 24 giờ; `null` khi chưa có lượt kết thúc. */
    error_rate: z.strictObject({
      value: Pct.nullable(),
      yesterday: Pct.nullable(),
      ended: Count,
      failed: Count,
      series: Series(Pct.nullable()),
    }),
    p95: z.strictObject({
      minutes: Pct.nullable(),
      yesterday_minutes: Pct.nullable(),
      n: Count,
      p95_basis: z.enum(OVERVIEW_P95_BASES),
      series: Series(Pct.nullable()),
    }),
    /** Lần chạy Dify (công cụ AI) báo lỗi trong 24 giờ (`hub.dify_runs.status = 'failed'`, kể cả lần đã thử lại thành công). */
    ai_tool_errors: z.strictObject({ value: Count, yesterday: Count, series: Series(Count) }),
    /** Chi phí AI tháng này / hạn mức USD đã đặt (cộng các công ty có hạn mức USD toàn công ty). `series` = chi phí USD mỗi ngày. */
    ai_quota: z.strictObject({
      used_pct: Pct.nullable(),
      used_usd: Pct,
      limit_usd: Pct,
      tenants_with_limit: Count,
      series: Series(Pct),
    }),
    /** Công ty (khách, đang hoạt động) có lượt chạy quy trình hoặc dùng AI trong 7 ngày / tổng. `series` = công ty có lượt chạy mỗi ngày. */
    companies: z.strictObject({ active_7d: Count, total: Count, series: Series(Count) }),
  }),
  hourly: z
    .array(z.strictObject({ hour_start: z.string(), ok: Count, error: Count }))
    .length(OVERVIEW_HOURS),
  attention: z.strictObject({
    stuck_runs: z.strictObject({ count: Count, hours: z.number().int(), link: z.string() }),
    unrouted_companies: z.strictObject({ count: Count, link: z.string() }),
    failing_ai_tools: z.strictObject({ count: Count, streak: z.number().int(), link: z.string() }),
    near_quota_companies: z.strictObject({ count: Count, pct: z.number().int(), link: z.string() }),
    half_configured: z.strictObject({ count: Count, link: z.string() }),
  }),
  health: z.strictObject({
    queue: z.strictObject({
      lag_s: Pct,
      queued: Count,
      oldest_wait_s: Pct,
      timer_overdue_s: Pct,
    }),
    dify: z.strictObject({
      error_rate_1h: Pct.nullable(),
      calls_1h: Count,
      errors_24h: Count,
      top_failing_tool: z
        .strictObject({ id: z.string(), name: z.string(), errors: Count })
        .nullable(),
    }),
    db: z.strictObject({
      ok: z.boolean(),
      ping_ms: Pct,
      slow_query_ms: Pct.nullable(),
      connections: Count,
      max_connections: Count,
      size_bytes: Count,
    }),
    deploy: z.strictObject({ version: z.string().nullable(), checked_at: z.string().nullable() }),
  }),
});
export type OpsOverview = z.infer<typeof OpsOverviewSchema>;
