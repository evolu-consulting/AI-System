// W1 · "Mua hàng": kiểu ra + hằng số của báo cáo nguồn hàng ở lớp domain (ADR-0023: domain/application không import `@ai/contracts`).
// Bản sao có chủ đích của `packages/contracts/src/pack-contracts/sourcing.ts`; `dto-mirror.test.ts` kiểm hai bên gán được cho nhau.

/** Số ứng viên nguồn tối đa mỗi sản phẩm trả về. */
export const SOURCING_CANDIDATES_MAX = 20;
export const SOURCING_PAGE_SIZE = 50;

export type SourcingRisk = "source_expiring" | "source_ended";
export type SourcingParty = { key: string | null; name: string | null };
export type SourceRef = {
  contract_id: string;
  number: string | null;
  line: number;
  supplier: SourcingParty;
  price: number | null;
  unit: string | null;
  current: boolean;
  status: string;
  end_date: string | null;
};
export type SaleLine = {
  product: string;
  name: string;
  code: string | null;
  unit: string | null;
  qty: number | null;
  price: number | null;
  contract_id: string;
  number: string | null;
  line: number;
  kind: "contract" | "appendix";
  end_date: string | null;
  customer: SourcingParty;
  source: (SourceRef & { mode: "chosen" | "auto" }) | null;
  margin: number | null;
  margin_pct: number | null;
  profit: number | null;
  risk: SourcingRisk | null;
};
export type SupplierExposure = {
  supplier: SourcingParty;
  lines: number;
  customers: string[];
  at_risk: number;
  profit: number;
};
export type SourcingOut = {
  stats: { lines: number; profit: number; sourced: number; at_risk: number };
  total: number;
  page: number;
  page_size: number;
  lines: SaleLine[];
  candidates: Record<string, SourceRef[]>;
  suppliers: SupplierExposure[];
  truncated: boolean;
};
/** Đầu vào đã qua zod ở route (`SourcingQuerySchema`, `SourceChoiceSchema`). */
export type SourcingQuery = {
  contract?: string | undefined;
  q?: string | undefined;
  risk?: "0" | "1" | undefined;
  page?: number | undefined;
  page_size?: number | undefined;
};
export type SourceChoice = {
  contract_id?: string | null | undefined;
  line?: number | null | undefined;
};
