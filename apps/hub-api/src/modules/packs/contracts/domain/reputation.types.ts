// HD8 · V2-E · ADR-0023: bản sao kiểu đầu vào chấm điểm / uy tín (`@ai/contracts`) cho lớp 1–2 — chỉ kiểu, khớp hai chiều kiểm ở
// `dto-mirror.test.ts`.
import type { ProductGroup } from "./products.types";

type RepRoleIn = "customer" | "supplier" | "commission_payer";
type OptText = string | null | undefined;

export type QuoteCreate = {
  product: string;
  supplier_name: string;
  price: number;
  quoted_at: string;
  product_name?: OptText;
  unit?: OptText;
  supplier_tax_id?: OptText;
  url?: OptText;
  note?: OptText;
};

export type RatingRequest = {
  party: string;
  role: "customer" | "supplier";
  criterion: string;
  value: number;
  note?: OptText;
};

export type ScoringDraft = {
  criteria: {
    enabled: boolean;
    weight: number;
    key?: OptText;
    kind?: "auto" | "manual" | null | undefined;
    label?: OptText;
  }[];
  rules: {
    good_from: number;
    fair_from: number;
    min_events: number;
    window_months: number;
    recency_boost: boolean;
    recency_months: number;
    manual_adjust: boolean;
  };
};

export type RepJobIn = {
  party: string;
  role: RepRoleIn;
  group: ProductGroup;
  job_type: string;
  at?: OptText;
  note?: OptText;
  contract_id?: OptText;
};

export type RepRatingIn = {
  party: string;
  role: RepRoleIn;
  group: ProductGroup;
  criterion: string;
  stars: number;
  reason?: OptText;
};

export type RepCellConfigIn = {
  criteria: {
    label: string;
    kind: "manual" | "ontime" | "jobs" | "bad_count";
    weight: number;
    enabled: boolean;
    key?: OptText;
    milestone?: "delivery" | "commission" | "serial" | "payment" | null | undefined;
    penalty?: number | null | undefined;
  }[];
  window_months: number;
  decay: { months: number[]; factors: number[] };
  late_per_day: number;
};

export type RepSettingsIn = {
  good_from: number;
  fair_from: number;
  min_jobs: number;
  manual_share: number;
  reason_gap: number;
  lock_period: "month";
};

export type RepJobTypesIn = {
  items: { key: string; name: string; criterion: string; score: number }[];
};

export type RepPreviewIn = {
  cell?: { group: ProductGroup; role: RepRoleIn; config: RepCellConfigIn } | null | undefined;
  settings?: RepSettingsIn | null | undefined;
  job_types?: RepJobTypesIn["items"] | null | undefined;
};
