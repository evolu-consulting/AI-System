// CR-104 · ops-watch (docs/specs/ops-watch/proposal.md) · contract "Tình trạng hệ thống": trạng thái check, cấu hình (Quyết định 6:
// tần suất 5–1440 phút, bật/tắt + ngưỡng warn/crit từng check theo đơn vị riêng), sự kiện, phản hồi `GET/POST /ops/*`.
// Ngưỡng `null` = check đó không dùng ngưỡng số cho mức này (vd crit của Provider AI là `logged_out`/`error`).
import { z } from "zod";
import { UuidSchema } from "../common";

export const OPS_STATUSES = ["ok", "warn", "crit", "unknown"] as const;
export const OpsStatusSchema = z.enum(OPS_STATUSES);
export type OpsStatus = z.infer<typeof OpsStatusSchema>;

/** 8 check v1 (bảng ở proposal §2). */
export const OPS_CHECK_KEYS = [
  "provider",
  "runs_failed",
  "db_redis",
  "public_hosts",
  "tls",
  "backup",
  "disk",
  "stuck",
] as const;
export const OpsCheckKeySchema = z.enum(OPS_CHECK_KEYS);
export type OpsCheckKey = z.infer<typeof OpsCheckKeySchema>;

export const OPS_UNITS = ["min", "pct", "count", "days", "hours", "fails"] as const;
export type OpsUnit = (typeof OPS_UNITS)[number];
export type OpsRange = { min: number; max: number; default: number };
/**
 * Mô tả ngưỡng mỗi check (UI dựng ô nhập theo đây). `order`: `asc` ⇒ warn < crit (giá trị càng lớn càng xấu), `desc` ⇒ warn > crit
 * (vd số ngày còn lại của TLS), `null` ⇒ warn/crit đo hai thứ khác nhau (không so).
 */
export type OpsCheckMeta = {
  label: string;
  unit: OpsUnit;
  warn: OpsRange | null;
  crit: OpsRange | null;
  order: "asc" | "desc" | null;
  /** Ý nghĩa ngưỡng (tiếng Việt, hiện cạnh ô nhập). */
  note: string;
};

export const OPS_CHECK_META: Readonly<Record<OpsCheckKey, OpsCheckMeta>> = {
  provider: {
    label: "Provider AI",
    unit: "min",
    warn: { min: 5, max: 1440, default: 30 },
    crit: null,
    order: null,
    note: "warn: cooldown/busy quá N phút; crit: logged_out/error hoặc mọi provider không ok",
  },
  runs_failed: {
    label: "Run AI thất bại",
    unit: "pct",
    warn: { min: 1, max: 100, default: 20 },
    crit: { min: 0, max: 1000, default: 0 },
    order: null,
    note: "warn: % run failed 1 giờ qua (≥ 10 run); crit: số ALL_PROVIDERS_EXHAUSTED trong 30 phút > N",
  },
  db_redis: {
    label: "DB / Redis",
    unit: "count",
    warn: null,
    crit: null,
    order: null,
    note: "crit khi ping lỗi",
  },
  public_hosts: {
    label: "Host công khai",
    unit: "fails",
    warn: { min: 1, max: 10, default: 1 },
    crit: { min: 1, max: 10, default: 2 },
    order: "asc",
    note: "số lần lỗi liên tiếp",
  },
  tls: {
    label: "Chứng chỉ TLS",
    unit: "days",
    warn: { min: 1, max: 90, default: 14 },
    crit: { min: 0, max: 90, default: 3 },
    order: "desc",
    note: "số ngày còn lại trước khi hết hạn",
  },
  backup: {
    label: "Backup",
    unit: "hours",
    warn: null,
    crit: { min: 1, max: 168, default: 26 },
    order: null,
    note: "warn: OFFSITE_DIR chưa đặt; crit: bản mới nhất quá N giờ hoặc lỗi",
  },
  disk: {
    label: "Đĩa server",
    unit: "pct",
    warn: { min: 1, max: 100, default: 80 },
    crit: { min: 1, max: 100, default: 90 },
    order: "asc",
    note: "% dung lượng đã dùng",
  },
  stuck: {
    label: "Hàng đợi / run kẹt",
    unit: "count",
    warn: { min: 0, max: 1000, default: 0 },
    crit: { min: 0, max: 1000, default: 5 },
    order: "asc",
    note: "số job orphaned / run quy trình running quá timeout trong 1 giờ (> N)",
  },
};

export const OPS_EVERY_MIN = { min: 5, max: 1440, default: 30 } as const;
export const OPS_EVENTS_KEEP = 500;
export const OPS_EVENTS_PAGE = 50;

const level = (r: OpsRange | null) => (r ? z.number().int().min(r.min).max(r.max) : z.null());

function checkSchema(key: OpsCheckKey) {
  const m = OPS_CHECK_META[key];
  return z
    .strictObject({ enabled: z.boolean(), warn: level(m.warn), crit: level(m.crit) })
    .refine(
      (v) =>
        m.order === null ||
        v.warn === null ||
        v.crit === null ||
        (m.order === "asc" ? v.warn < v.crit : v.warn > v.crit),
      {
        message:
          m.order === "asc" ? "warn phải nhỏ hơn crit" : "warn phải lớn hơn crit (số ngày còn lại)",
        path: ["crit"],
      },
    );
}

export const OpsCheckSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  warn: z.number().int().nullable(),
  crit: z.number().int().nullable(),
});
export type OpsCheckSettings = z.infer<typeof OpsCheckSettingsSchema>;

/** Cấu hình đầy đủ (PUT gửi cả khối; mọi check phải có). */
export const OpsSettingsSchema = z.strictObject({
  every_min: z.number().int().min(OPS_EVERY_MIN.min).max(OPS_EVERY_MIN.max),
  checks: z.strictObject(
    Object.fromEntries(OPS_CHECK_KEYS.map((k) => [k, checkSchema(k)])) as {
      [K in OpsCheckKey]: ReturnType<typeof checkSchema>;
    },
  ),
});
export type OpsSettings = { every_min: number; checks: Record<OpsCheckKey, OpsCheckSettings> };

export const OPS_DEFAULT_SETTINGS: OpsSettings = {
  every_min: OPS_EVERY_MIN.default,
  checks: Object.fromEntries(
    OPS_CHECK_KEYS.map((k) => {
      const m = OPS_CHECK_META[k];
      return [k, { enabled: true, warn: m.warn?.default ?? null, crit: m.crit?.default ?? null }];
    }),
  ) as Record<OpsCheckKey, OpsCheckSettings>,
};

/**
 * Cấu hình hiệu lực từ jsonb đã lưu: thiếu khoá ⇒ mặc định (từng check), khoá lạ bị bỏ; bản lưu không hợp lệ ⇒ mặc định
 * (fail-safe: vẫn kiểm theo ngưỡng mặc định thay vì dừng theo dõi).
 */
export function opsSettingsFrom(raw: unknown): OpsSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const checks = (o.checks && typeof o.checks === "object" ? o.checks : {}) as Record<
    string,
    unknown
  >;
  const merged = {
    every_min: o.every_min ?? OPS_DEFAULT_SETTINGS.every_min,
    checks: Object.fromEntries(
      OPS_CHECK_KEYS.map((k) => [k, checks[k] ?? OPS_DEFAULT_SETTINGS.checks[k]]),
    ),
  };
  const r = OpsSettingsSchema.safeParse(merged);
  return r.success ? (r.data as OpsSettings) : OPS_DEFAULT_SETTINGS;
}

export const OpsCheckRowSchema = z.strictObject({
  check_key: z.string(),
  status: OpsStatusSchema,
  value: z.unknown(),
  message: z.string(),
  hint: z.string().nullable(),
  checked_at: z.string(),
  changed_at: z.string(),
});
export type OpsCheckRow = z.infer<typeof OpsCheckRowSchema>;

export const OPS_EVENT_KINDS = ["status", "settings_changed"] as const;
export const OpsEventSchema = z.strictObject({
  id: z.number().int(),
  check_key: z.string().nullable(),
  from_status: OpsStatusSchema.nullable(),
  to_status: OpsStatusSchema.nullable(),
  kind: z.enum(OPS_EVENT_KINDS),
  actor_user_id: UuidSchema.nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
  at: z.string(),
});
export type OpsEvent = z.infer<typeof OpsEventSchema>;

/** `GET /ops/settings`, `PUT /ops/settings`. */
export const OpsSettingsResponseSchema = z.strictObject({
  settings: OpsSettingsSchema,
  updated_at: z.string(),
  updated_by: UuidSchema.nullable(),
});
export type OpsSettingsResponse = z.infer<typeof OpsSettingsResponseSchema>;

/** `GET /ops/status`, `POST /ops/check` (sau lượt kiểm): check mới nhất + 50 sự kiện gần nhất + cấu hình. */
export const OpsStatusResponseSchema = z.strictObject({
  checks: z.array(OpsCheckRowSchema),
  events: z.array(OpsEventSchema).max(OPS_EVENTS_PAGE),
  settings: OpsSettingsSchema,
  last_round_at: z.string().nullable(),
});
export type OpsStatusResponse = z.infer<typeof OpsStatusResponseSchema>;

/** Lỗi riêng của `/ops/*` (ngoài FORBIDDEN/AUTH_EXPIRED chung). */
export const OPS_ERRORS = {
  OPS_SETTINGS_INVALID: 422,
  OPS_CHECK_RATE_LIMITED: 429,
} as const satisfies Record<string, 422 | 429>;
export type OpsErrorCode = keyof typeof OPS_ERRORS;
