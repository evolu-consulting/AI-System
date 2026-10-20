// V2-J1 · ADR-0023: bản sao kiểu DTO điểm kinh doanh (`@ai/contracts` pack-contracts/business) cho lớp 1–2 — chỉ kiểu, khớp hai
// chiều kiểm ở `dto-mirror.test.ts`.
import type { ProductGroup } from "./products.types";

export type BizSuggestion = "buy" | "hold" | "dump" | "push" | "keep" | "stop";
export type BizKind = "stock" | "quota" | "order" | "referral";

export type BizConfig = {
  w: { rot: number; margin: number; trend: number };
  buyDays: number;
  dumpDays: number;
  quotaBuy: number;
  quotaDump: number;
  hi: number;
  lo: number;
  vol: number;
  soon: number;
};

export type BizFactor = {
  key: "rot" | "margin" | "trend";
  label: string;
  weight: number;
  value: number | null;
  detail: string;
};

export type BizScore = {
  score: number | null;
  suggestion: BizSuggestion | null;
  reason: string;
  factors: BizFactor[];
};

export type BizHeld = {
  qty: number;
  unit: string | null;
  expires_on: string | null;
  value: number;
};

export type BizProductRow = {
  id: string;
  name: string;
  unit: string | null;
  group: ProductGroup;
  kind: BizKind;
  held: BizHeld;
  sold_12m: number;
  sold_3m: number;
  business: BizScore;
};

export type BizLotOut = {
  id: string;
  received_on: string;
  qty: number;
  remaining: number;
  unit_cost: number | null;
  price_change: number | null;
  expires_on: string | null;
  supplier: string | null;
  contract_id: string | null;
  component: string;
};

export type BizSaleOut = {
  on: string;
  contract_id: string;
  contract_title: string;
  customer: string | null;
  qty: number;
  unit_price: number | null;
  cost: number | null;
  profit: number | null;
};

export type BizDetailOut = {
  product: BizProductRow;
  revenue_12m: number;
  margin_pct: number | null;
  lots: BizLotOut[];
  sales: BizSaleOut[];
  contracts_count: number;
};

export type BizListOut = { items: BizProductRow[]; counts: Record<"all" | ProductGroup, number> };
export type BizListQuery = { group?: ProductGroup | undefined; q?: string | undefined };

export type BizConfigOut = {
  config: BizConfig;
  defaults: BizConfig;
  version: number;
  updated_at: string | null;
};

export type BizContractOut = {
  id: string;
  title: string;
  number: string | null;
  deal: "buy" | "sell" | "referral" | null;
  status: string;
  partner: string | null;
  value: number | null;
  start_date: string | null;
  commission_total: number | null;
  commission_received: number | null;
};

export type BizPreviewIn = {
  config: BizConfig;
  sample: {
    kind: BizKind;
    held: number;
    l3: number;
    p3: number;
    cost: number;
    price: number;
    dte: number;
  };
};
