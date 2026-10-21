// gap-d1 #19 · ADR-0023: bản sao kiểu DTO "Cách lấy hàng" (`@ai/contracts` pack-contracts/product-sources) cho lớp 1–2 — chỉ kiểu, khớp
// hai chiều kiểm ở `dto-mirror.test.ts`.

export type ProductSourceCreate = {
  supplier_name: string;
  supplier_tax_id?: string | null | undefined;
  lead_days?: number | null | undefined;
  moq?: string | null | undefined;
  price_ref?: number | null | undefined;
  note?: string | null | undefined;
};

export type ProductSourceOut = {
  id: string;
  supplier_name: string;
  party_key: string;
  lead_days: number | null;
  moq: string | null;
  price_ref: number | null;
  note: string | null;
  created_at: string;
};

export type DependencyLevel = "high" | "medium" | "low";

export type DependencyRow = {
  supplier_name: string;
  party_key: string;
  share_pct: number;
  declared: boolean;
  lead_days: number | null;
  level: DependencyLevel;
};

export type ProductSourcesOut = {
  items: ProductSourceOut[];
  risk: DependencyRow[];
  single_source: boolean;
};
