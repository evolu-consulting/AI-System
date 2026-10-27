// tenant-quotas · hạn mức NGÀY theo công ty (Admin › Công ty › Quota): lượt tải HĐ, lượt thao tác AI của gói contracts, token
// AI. Giá trị riêng (null = dùng env của hub-api) ở `admin.tenant_daily_limits`; hub-api đọc qua cache cấu hình.
// Thuần, không I/O: luật chọn giá trị hiệu lực + tên khoá bộ đếm Redis dùng chung admin-api (đọc/đặt lại) và hub-api (đếm).
import { z } from "zod";
import { UuidSchema } from "./common";

export const DAILY_LIMIT_KINDS = ["uploads", "actions", "ai_tokens"] as const;
export type DailyLimitKind = (typeof DAILY_LIMIT_KINDS)[number];

/** Biến env hub-api cho từng loại (giữ nguyên tên/mặc định hiện có). */
export const DAILY_LIMIT_ENV: Readonly<Record<DailyLimitKind, string>> = {
  uploads: "CONTRACTS_UPLOADS_TENANT_DAY",
  actions: "CONTRACTS_ACTIONS_TENANT_DAY",
  ai_tokens: "AI_TENANT_DAILY_TOKENS",
};
export const DAILY_LIMIT_DEFAULTS: Readonly<Record<DailyLimitKind, number>> = {
  uploads: 30,
  actions: 100,
  ai_tokens: 5_000_000,
};
/** Trần nhập (khớp CHECK của bảng). */
export const DAILY_LIMIT_MAX: Readonly<Record<DailyLimitKind, number>> = {
  uploads: 1_000_000,
  actions: 1_000_000,
  ai_tokens: 1_000_000_000_000,
};

type Env = Record<string, string | undefined>;

/**
 * Giá trị env như hub-api đang đọc: lượt tải/thao tác = số nguyên dương, sai/vắng ⇒ mặc định; token AI = số nguyên ≥ 0,
 * `0` ⇒ không trần (null), sai/vắng ⇒ mặc định.
 */
export function envDailyLimit(kind: DailyLimitKind, env: Env): number | null {
  const raw = env[DAILY_LIMIT_ENV[kind]];
  const def = DAILY_LIMIT_DEFAULTS[kind];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (kind === "ai_tokens") {
    if (!Number.isInteger(n) || n < 0) return def;
    return n === 0 ? null : n;
  }
  return Number.isInteger(n) && n > 0 ? n : def;
}

/** Giá trị hiệu lực: riêng của công ty (≠ null) thắng env; null ⇒ env (env null = không trần). */
export function effectiveDailyLimit(
  override: number | null | undefined,
  envValue: number | null,
): number | null {
  return override ?? envValue;
}

/** Ngày lịch `YYYY-MM-DD` ở múi `timeZone` (cùng luật `uploadDay` của hub-api). */
export function tenantLocalDay(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}

/** 00:00 UTC của ngày `now` — mốc ngày của trần token AI (`ai-client` đếm theo ngày UTC). */
export const utcDayStart = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export const DAILY_COUNTER_PREFIX = "q:contracts:";

/**
 * Khoá bộ đếm Redis của tenant cho một ngày (mốc ngày theo múi tenant), khớp `upload-counter.redis.ts` (`t:`) và
 * `action-quota.ts` (`a:`). Token AI không đếm trên Redis (đếm `hub.usage_logs`).
 */
export function dailyCounterKey(
  kind: Exclude<DailyLimitKind, "ai_tokens">,
  tenantId: string,
  day: string,
): string {
  return `${DAILY_COUNTER_PREFIX}${kind === "uploads" ? "t" : "a"}:${tenantId}:${day}`;
}

/**
 * Mốc bắt đầu đếm token AI hôm nay: 00:00 UTC, hoặc lúc platform_admin bấm "Đặt lại hôm nay" nếu sau đó (mốc đặt lại của
 * ngày trước không còn tác dụng).
 */
export function aiTokensSince(now: Date, resetAt: Date | null): Date {
  const day = utcDayStart(now);
  return resetAt && resetAt.getTime() > day.getTime() ? resetAt : day;
}

const limitSchema = (kind: DailyLimitKind) =>
  z.number().int().min(1).max(DAILY_LIMIT_MAX[kind]).nullable();

/** PUT /admin/tenants/:id/daily-limits — thay cả bộ; null = dùng env. */
export const DailyLimitsPutSchema = z.strictObject({
  uploads: limitSchema("uploads"),
  actions: limitSchema("actions"),
  ai_tokens: limitSchema("ai_tokens"),
});
export type DailyLimitsPut = z.infer<typeof DailyLimitsPutSchema>;

export const DailyLimitKindSchema = z.enum(DAILY_LIMIT_KINDS);

export const DailyLimitItemSchema = z.object({
  kind: DailyLimitKindSchema,
  /** Giá trị riêng của công ty; null = dùng env. */
  override: z.number().int().nullable(),
  /** Giá trị env (admin-api đọc cùng biến với hub-api); null = không trần. */
  env_default: z.number().int().nullable(),
  effective: z.number().int().nullable(),
  /** Đã dùng hôm nay; null = không đọc được (Redis vắng/lỗi). */
  used: z.number().int().nullable(),
  /** Ngày đang đếm `YYYY-MM-DD` (uploads/actions: múi tenant; ai_tokens: UTC). */
  day: z.string(),
});
export type DailyLimitItem = z.infer<typeof DailyLimitItemSchema>;

export const DailyLimitsResponseSchema = z.object({
  tenant_id: UuidSchema,
  timezone: z.string(),
  items: z.array(DailyLimitItemSchema),
});
export type DailyLimitsResponse = z.infer<typeof DailyLimitsResponseSchema>;
