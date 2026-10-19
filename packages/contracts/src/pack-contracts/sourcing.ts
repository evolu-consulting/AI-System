// W1 · "Mua hàng" (mgmt-app `api/app/routes/sourcing.py` + `contracts/sourcing.py`, `cm-web/app/sourcing`): mỗi dòng hàng đang bán
// mua từ nhà cung cấp nào, lãi bao nhiêu, bán nào dựa vào HĐ mua sắp hết hạn. `GET /pack/contracts/sourcing?contract=`,
// `PUT /pack/contracts/sourcing/:contractId/:line`. `line` = `ord` của dòng hàng trong HĐ (mgmt: chỉ số mảng).
import { z } from "zod";

export const SOURCING_ERRORS = { SOURCING_INVALID: 422 } as const;
export type SourcingErrorCode = keyof typeof SOURCING_ERRORS;
export const SOURCING_RISKS = ["source_expiring", "source_ended"] as const;
export type SourcingRisk = (typeof SOURCING_RISKS)[number];
/** Số ứng viên nguồn tối đa mỗi dòng bán trả về (đã sắp: còn hiệu lực trước, rẻ trước). */
export const SOURCING_CANDIDATES_MAX = 20;
export const SOURCING_LINE_MAX = 9999;

export const SOURCING_PAGE_SIZE = 50;
export const SOURCING_PAGE_MAX = 100;
const intText = (max: number) =>
  z
    .string()
    .regex(/^\d{1,9}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(max));
/** Trang tính ở máy chủ: `q` tìm (bỏ dấu) trong sản phẩm / số HĐ / khách / nhà cung cấp; `risk=1` chỉ dòng có rủi ro. */
export const SourcingQuerySchema = z.strictObject({
  contract: z.uuid().optional(),
  q: z.string().max(100).optional(),
  risk: z.enum(["0", "1"]).optional(),
  page: intText(1_000_000).optional(),
  page_size: intText(SOURCING_PAGE_MAX).optional(),
});
export type SourcingQuery = z.infer<typeof SourcingQuerySchema>;
export const SourceChoiceSchema = z.strictObject({
  contract_id: z.uuid().nullish(),
  line: z.number().int().min(0).max(SOURCING_LINE_MAX).nullish(),
});
export type SourceChoice = z.infer<typeof SourceChoiceSchema>;

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
export type SourcingStats = { lines: number; profit: number; sourced: number; at_risk: number };
export type SourcingOut = {
  /** Số liệu trên MỌI dòng bán (sau lọc `contract`), không theo tìm / lọc rủi ro / trang. */
  stats: SourcingStats;
  /** Số dòng bán khớp tìm + lọc rủi ro (cho phân trang). */
  total: number;
  page: number;
  page_size: number;
  /** Một trang dòng bán: dòng rủi ro trước, rồi theo số HĐ, dòng. */
  lines: SaleLine[];
  /** Ứng viên nguồn theo sản phẩm của các dòng trong trang (`SaleLine.product`): còn hiệu lực trước, rẻ trước, ≤ SOURCING_CANDIDATES_MAX + nguồn đang dùng. */
  candidates: Record<string, SourceRef[]>;
  /** Nhà cung cấp mà dòng bán dựa vào (≤ 200), rủi ro nhiều trước. */
  suppliers: SupplierExposure[];
  /** Quá giới hạn đọc (2.000 HĐ) ⇒ báo cắt. */
  truncated: boolean;
};
