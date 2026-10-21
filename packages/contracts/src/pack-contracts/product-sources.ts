// gap-d1 #19 · BA v2 KN-09 · "Cách lấy hàng" theo SP: danh sách nguồn (NCC, thời gian giao, SL tối thiểu, giá tham chiếu) + bảng rủi ro
// phụ thuộc NCC. `GET /pack/contracts/products/:id/sources`, `POST /products/:id/sources`, `DELETE /products/:id/sources/:sourceId`.
// SP Giới thiệu không có cách lấy hàng ⇒ 404. Trùng NCC trong cùng SP ⇒ 409 `SOURCE_EXISTS`. Tiền = số nguyên đồng (chưa VAT).
import { z } from "zod";

export const PRODUCT_SOURCE_ERRORS = { SOURCE_EXISTS: 409 } as const;
export type ProductSourceErrorCode = keyof typeof PRODUCT_SOURCE_ERRORS;

export const ProductSourceCreateSchema = z.strictObject({
  supplier_name: z.string().trim().min(1).max(300),
  supplier_tax_id: z.string().trim().max(30).nullish(),
  lead_days: z.number().int().min(0).max(3650).nullish(),
  moq: z
    .string()
    .trim()
    .regex(/^\d{1,14}(\.\d{1,4})?$/)
    .nullish(),
  price_ref: z.number().int().min(1).max(1_000_000_000_000).nullish(),
  note: z.string().trim().max(500).nullish(),
});
export type ProductSourceCreate = z.infer<typeof ProductSourceCreateSchema>;

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

/** Mức rủi ro phụ thuộc: high = một NCC ≥ 70% giá trị mua và chưa có nguồn dự phòng; medium = ≥ 70% (có dự phòng) hoặc ≥ 50% không dự phòng. */
export const DEPENDENCY_LEVELS = ["high", "medium", "low"] as const;
export type DependencyLevel = (typeof DEPENDENCY_LEVELS)[number];

export type DependencyRow = {
  supplier_name: string;
  party_key: string;
  /** Tỉ trọng giá trị đã nhập của NCC trong tổng đã nhập của SP (%, làm tròn); 0 khi chưa mua. */
  share_pct: number;
  /** Có khai báo trong "Cách lấy hàng" (nguồn dự phòng đã biết). */
  declared: boolean;
  lead_days: number | null;
  level: DependencyLevel;
};

export type ProductSourcesOut = {
  items: ProductSourceOut[];
  risk: DependencyRow[];
  /** Chỉ có đúng một NCC (đã mua hoặc khai báo) ⇒ rủi ro nguồn đơn. */
  single_source: boolean;
};
