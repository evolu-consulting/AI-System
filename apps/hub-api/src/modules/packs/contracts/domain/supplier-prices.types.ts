// V2-J2 · ADR-0023: bản sao kiểu DTO "Nhà cung cấp & giá" (`@ai/contracts` pack-contracts/supplier-prices) cho lớp 1–2 — chỉ kiểu,
// khớp hai chiều kiểm ở `dto-mirror.test.ts`.
import type { ProductGroup } from "./products.types";

export type SupplierPriceKind = "new" | "renew";
export type SupplierPriceSource = "quote" | "manual" | "purchase" | "market";
export type SupplierAdvice = "keep" | "backup" | "replace" | "trial";

export type SupplierSearchItem = {
  supplier_name: string;
  kind: SupplierPriceKind;
  price: number;
  unit: string | null;
  url: string | null;
  seen_on: string | null;
  note: string | null;
};

export type SupplierSearchOut = { query: string; items: SupplierSearchItem[] };

export type SupplierPriceRow = {
  id: string | null;
  supplier_name: string;
  party_key: string | null;
  kind: SupplierPriceKind;
  price: number;
  unit: string | null;
  source: SupplierPriceSource;
  url: string | null;
  on: string | null;
  vs_own_pct: number | null;
  reputation: { score: number | null; level: "good" | "fair" | "watch" | "new" } | null;
};

export type SupplierSummaryRow = {
  supplier_name: string;
  party_key: string;
  bought_qty: string;
  bought_times: number;
  bought_amount: number;
  share_pct: number;
  last_on: string | null;
  last_price: number | null;
  best_price: number;
  reputation: SupplierPriceRow["reputation"];
  advice: SupplierAdvice | null;
};

export type SupplierOverviewOut = {
  product: { id: string; name: string; unit: string | null; group: ProductGroup };
  own_avg_cost: number | null;
  rows: SupplierPriceRow[];
  suppliers: SupplierSummaryRow[];
};

export type SupplierPriceInput = {
  supplier_name: string;
  kind: SupplierPriceKind;
  price: number;
  source: "quote" | "manual" | "market";
  supplier_tax_id?: string | null | undefined;
  unit?: string | null | undefined;
  url?: string | null | undefined;
  seen_on?: string | null | undefined;
  note?: string | null | undefined;
};
