// V2-L · CD-01 · BA v2 §4.5: nhận diện công ty (`GET|PUT /pack/contracts/company`) — tên, tên ứng dụng, logo ≤ 1 MB, màu chủ đạo (6),
// giao diện, tên + MST của chính công ty (V2-G đoán Mua/Bán) và cờ duyệt hợp đồng (V2-A). Thân strict; ghi chỉ quản lý.
import { z } from "zod";
import { nfcText } from "./fields";

export const COMPANY_ACCENTS = ["indigo", "blue", "teal", "green", "orange", "rose"] as const;
export type CompanyAccent = (typeof COMPANY_ACCENTS)[number];
export const COMPANY_THEMES = ["auto", "light", "dark"] as const;
export type CompanyTheme = (typeof COMPANY_THEMES)[number];
/** Logo ≤ 1 MB (ảnh gốc; base64 trong data URL dài hơn ~4/3). */
export const COMPANY_LOGO_MAX_BYTES = 1_048_576;
export const COMPANY_ERRORS = { COMPANY_INVALID: 422 } as const;

const DATA_URL = /^data:image\/(?:png|jpeg|svg\+xml|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
/** Số byte của ảnh trong data URL (null ⇒ không phải data URL ảnh hợp lệ). */
export function logoBytes(dataUrl: string): number | null {
  const m = DATA_URL.exec(dataUrl);
  const b64 = m?.[1];
  if (!b64) return null;
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
}
const Logo = z
  .string()
  .max(1_500_000)
  .refine((v) => (logoBytes(v) ?? Number.POSITIVE_INFINITY) <= COMPANY_LOGO_MAX_BYTES, {
    message: "Logo phải là ảnh PNG, JPG, SVG hoặc WebP, tối đa 1 MB",
  });
/** Rỗng ⇒ null (dùng mặc định). */
const optName = (max: number) =>
  nfcText(max)
    .nullable()
    .transform((v) => (v ? v : null));
export const MST_RE = /^\d{10}(?:-?\d{3})?$/;

export const CompanySchema = z.strictObject({
  name: optName(60),
  app_name: optName(40),
  logo: Logo.nullable(),
  accent: z.enum(COMPANY_ACCENTS),
  theme: z.enum(COMPANY_THEMES),
  /** Tên pháp nhân của mình (mỗi tên một dòng) — khớp tên bên mua/bên bán của hợp đồng. */
  own_names: z.array(nfcText(120).pipe(z.string().min(1))).max(10),
  own_tax_ids: z.array(z.string().regex(MST_RE)).max(10),
  /** Bật/tắt bước duyệt hợp đồng (V2-A). */
  approval_enabled: z.boolean(),
  /** Cho phép giao vượt tồn kho (mặc định tắt); vắng ⇒ giữ nguyên. Bật ⇒ xác nhận giao không chặn khi thiếu kho, tồn có thể âm. */
  allow_negative_stock: z.boolean().optional(),
  /** DOC-legal · Câu 8: ngưỡng (đồng) cảnh báo pháp lý cho giao dịch đứng riêng; 0 = tắt; vắng ⇒ giữ nguyên. */
  legal_warn_threshold: z.number().int().min(0).max(1_000_000_000_000_000).optional(),
});
export type CompanyIn = z.infer<typeof CompanySchema>;

export type CompanyOut = {
  company: Omit<CompanyIn, "approval_enabled" | "allow_negative_stock" | "legal_warn_threshold">;
  approval_enabled: boolean;
  allow_negative_stock: boolean;
  legal_warn_threshold: number;
  /** Mặc định của tenant (cờ duyệt theo khoá tenant). */
  defaults: CompanyIn;
  version: number;
  updated_at: string | null;
};
