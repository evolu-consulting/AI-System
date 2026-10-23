// price-scout · cấu hình dò giá thị trường theo sản phẩm + mặc định theo nhóm SP + trần lượt dò/tháng của tenant (Sổ Hợp Tác ›
// Sản phẩm & Giá › tab Nhà cung cấp & giá › "Cấu hình dò giá"; Cài đặt › Dò giá thị trường).
// `GET|PUT /pack/contracts/products/:id/price-scout` (đọc: read; ghi: write) · `GET|PUT /pack/contracts/price-scout/defaults`
// (ghi: quản lý) · `GET|PUT /pack/contracts/price-scout/quota` (ghi: quản lý; trường `platform_*` chỉ platform_admin).
// RIÊNG TƯ: ra ngoài (agent tìm web) CHỈ tên SP + từ khoá/quy cách/đơn vị/trang/khu vực/VAT/tên NCC theo dõi do người dùng gõ
// (tên NCC công khai) — không MST, HĐ, tên đối tác lấy từ hồ sơ.
import { z } from "zod";

export const PRICE_SCOUT_SCHEDULES = ["off", "weekly", "monthly"] as const;
export type PriceScoutSchedule = (typeof PRICE_SCOUT_SCHEDULES)[number];
export const PRICE_SCOUT_VAT = ["excl", "incl"] as const;
export type PriceScoutVat = (typeof PRICE_SCOUT_VAT)[number];
export const PRICE_SCOUT_GROUPS = ["service", "goods"] as const;
export type PriceScoutGroup = (typeof PRICE_SCOUT_GROUPS)[number];

const LIST_MAX = 10;
const word = z.string().trim().min(1).max(80);
/** Tên miền (vd `shopee.vn`, `fpt.com.vn`) — không giao thức/đường dẫn. */
const site = z
  .string()
  .trim()
  .toLowerCase()
  .max(120)
  .regex(/^(?=.{3,120}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/, "site");

/** Cấu hình đầy đủ (mặc định nhóm). */
export const PriceScoutConfigSchema = z.strictObject({
  enabled: z.boolean(),
  keywords: z.array(word).max(LIST_MAX),
  spec: z.string().trim().max(200).nullable(),
  unit: z.string().trim().max(40).nullable(),
  include_sites: z.array(site).max(LIST_MAX),
  exclude_sites: z.array(site).max(LIST_MAX),
  watched_suppliers: z.array(z.string().trim().min(1).max(120)).max(LIST_MAX),
  region: z.string().trim().max(80).nullable(),
  vat: z.enum(PRICE_SCOUT_VAT),
  schedule: z.enum(PRICE_SCOUT_SCHEDULES),
  /** Báo khi giá thị trường thấp nhất lệch giá vốn BQ ≥ n% (null = không báo). */
  alert_pct: z.number().int().min(1).max(100).nullable(),
  /** Báo khi giá của NCC theo dõi thay đổi. */
  alert_watched: z.boolean(),
  /** Yêu cầu dò giá viết tự do (≤ 2000 ký tự) — gửi agent như DỮ LIỆU; thay các ô có cấu trúc ở màn SP (cột cũ giữ để tương thích). */
  instructions: z.string().trim().max(2000).nullable().default(null),
});
export type PriceScoutConfig = z.infer<typeof PriceScoutConfigSchema>;

/** Cấu hình riêng của SP: khoá vắng = theo mặc định nhóm. */
export const PriceScoutOverrideSchema = PriceScoutConfigSchema.partial();
export type PriceScoutOverride = z.infer<typeof PriceScoutOverrideSchema>;

export const PRICE_SCOUT_DEFAULT: PriceScoutConfig = {
  enabled: false,
  keywords: [],
  spec: null,
  unit: null,
  include_sites: [],
  exclude_sites: [],
  watched_suppliers: [],
  region: null,
  vat: "excl",
  schedule: "off",
  alert_pct: null,
  alert_watched: false,
  instructions: null,
};

/** Đã dùng / trần lượt dò tháng này (theo lịch tenant). `limit` null = không trần. */
export type PriceScoutUsage = {
  month: string;
  searches: number;
  tokens: number;
  searches_limit: number | null;
  tokens_limit: number | null;
};

export type PriceScoutProductOut = {
  product_id: string;
  group: PriceScoutGroup;
  /** Ghi đè riêng của SP. */
  override: PriceScoutOverride;
  /** Mặc định nhóm hiện hành. */
  defaults: PriceScoutConfig;
  /** = mặc định ⊕ ghi đè. */
  effective: PriceScoutConfig;
  next_at: string | null;
  last_at: string | null;
  last_status: string | null;
  usage: PriceScoutUsage;
};

export const PriceScoutDefaultsPutSchema = z.strictObject({
  group: z.enum(PRICE_SCOUT_GROUPS),
  config: PriceScoutConfigSchema,
});
export type PriceScoutDefaultsOut = { groups: Record<PriceScoutGroup, PriceScoutConfig> };

const capN = z.number().int().min(0).max(1_000_000).nullable();
const capT = z.number().int().min(0).max(10_000_000_000).nullable();
export const PriceScoutQuotaSchema = z.strictObject({
  searches_month: capN,
  tokens_month: capT,
  platform_searches_month: capN.optional(),
  platform_tokens_month: capT.optional(),
});
export type PriceScoutQuotaIn = z.infer<typeof PriceScoutQuotaSchema>;
export type PriceScoutQuotaOut = {
  searches_month: number | null;
  tokens_month: number | null;
  platform_searches_month: number | null;
  platform_tokens_month: number | null;
  /** Trần đang áp (platform ?? tenant ?? mặc định hệ thống). */
  usage: PriceScoutUsage;
  /** Người gọi là platform_admin (sửa được trường `platform_*`). */
  can_override: boolean;
};
