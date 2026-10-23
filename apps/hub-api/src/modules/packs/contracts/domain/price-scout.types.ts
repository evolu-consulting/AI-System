// price-scout · ADR-0023: bản sao kiểu DTO cấu hình dò giá (`@ai/contracts` pack-contracts/price-scout) cho lớp 1–2 — chỉ kiểu +
// mặc định, khớp hai chiều kiểm ở `price-scout.rules.test.ts`.
export type PriceScoutSchedule = "off" | "weekly" | "monthly";
export type PriceScoutVat = "excl" | "incl";
export type PriceScoutGroup = "service" | "goods";

export type PriceScoutConfig = {
  enabled: boolean;
  keywords: string[];
  spec: string | null;
  unit: string | null;
  include_sites: string[];
  exclude_sites: string[];
  watched_suppliers: string[];
  region: string | null;
  vat: PriceScoutVat;
  schedule: PriceScoutSchedule;
  alert_pct: number | null;
  alert_watched: boolean;
  instructions: string | null;
};
export type PriceScoutOverride = Partial<PriceScoutConfig>;

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
  override: PriceScoutOverride;
  defaults: PriceScoutConfig;
  effective: PriceScoutConfig;
  next_at: string | null;
  last_at: string | null;
  last_status: string | null;
  usage: PriceScoutUsage;
};
export type PriceScoutDefaultsOut = { groups: Record<PriceScoutGroup, PriceScoutConfig> };
export type PriceScoutQuotaRow = {
  searches_month: number | null;
  tokens_month: number | null;
  platform_searches_month: number | null;
  platform_tokens_month: number | null;
};
export type PriceScoutQuotaOut = PriceScoutQuotaRow & {
  usage: PriceScoutUsage;
  can_override: boolean;
};
