// V2-L · CD-01 · BA v2 §4.5: nhận diện công ty (`GET|PUT /pack/contracts/company`) — tên, tên ứng dụng, logo ≤ 1 MB, màu chủ đạo (12 + tự chọn),
// giao diện, tên + MST của chính công ty (V2-G đoán Mua/Bán) và cờ duyệt hợp đồng (V2-A). Thân strict; ghi chỉ quản lý.
import { z } from "zod";
import { ACCENT_HEX_RE, COMPANY_ACCENTS, checkAccent } from "./company-accent";
import { nfcText } from "./fields";

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
/** CR-138 Q9 · ảnh bìa công ty ≤ 3 MB (ảnh gốc), PNG/JPG/WebP (không SVG: ảnh to, dễ chứa script). Gợi ý tỉ lệ 4:1. */
export const COMPANY_COVER_MAX_BYTES = 3_145_728;
const COVER_URL = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
/** Số byte của ảnh bìa trong data URL (null ⇒ không phải PNG/JPG/WebP hợp lệ). */
export function coverBytes(dataUrl: string): number | null {
  const b64 = COVER_URL.exec(dataUrl)?.[1];
  if (!b64) return null;
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
}
const Cover = z
  .string()
  .max(4_300_000)
  .refine((v) => (coverBytes(v) ?? Number.POSITIVE_INFINITY) <= COMPANY_COVER_MAX_BYTES, {
    message: "Ảnh bìa phải là PNG, JPG hoặc WebP, tối đa 3 MB",
  });
/** CR-138 Q8 · khoá màu đặt sẵn hoặc `#RRGGBB` tự chọn đạt tương phản AA với chữ trắng (chuẩn hoá chữ thường). */
const Accent = z.union([
  z.enum(COMPANY_ACCENTS),
  z
    .string()
    .regex(ACCENT_HEX_RE, "Mã màu phải có dạng #RRGGBB")
    .transform((v) => v.toLowerCase())
    .refine((v) => checkAccent(v).ok, {
      message: "Màu quá nhạt: chữ trắng trên màu này khó đọc (cần tương phản ≥ 4.5:1)",
    }),
]);
/** Rỗng ⇒ null (dùng mặc định). */
const optName = (max: number) =>
  nfcText(max)
    .nullable()
    .transform((v) => (v ? v : null));
export const MST_RE = /^\d{10}(?:-?\d{3})?$/;

export const CompanySchema = z.strictObject({
  /** CR-121 c20: tên công ty = `admin.tenants.name` (chỉ đọc ở gói). Thân PUT vẫn nhận trường này để client cũ không bị 422 nhưng
   *  server BỎ QUA; đổi tên ở Admin › Công ty › Hồ sơ. Phản hồi luôn trả tên của tenant. */
  name: optName(60),
  app_name: optName(40),
  logo: Logo.nullable(),
  accent: Accent,
  /** CR-138 Q9: ảnh bìa công ty (hồ sơ Bảng tin); vắng ⇒ giữ nguyên, null ⇒ xoá. */
  cover: Cover.nullable().optional(),
  theme: z.enum(COMPANY_THEMES),
  /** Tên pháp nhân của mình (mỗi tên một dòng) — khớp tên bên mua/bên bán của hợp đồng. */
  own_names: z.array(nfcText(120).pipe(z.string().min(1))).max(10),
  own_tax_ids: z.array(z.string().regex(MST_RE)).max(10),
  /** Cho phép giao vượt tồn kho (mặc định tắt); vắng ⇒ giữ nguyên. Bật ⇒ xác nhận giao không chặn khi thiếu kho, tồn có thể âm. */
  allow_negative_stock: z.boolean().optional(),
  /** DOC-legal · Câu 8: ngưỡng (đồng) cảnh báo pháp lý cho giao dịch đứng riêng; 0 = tắt; vắng ⇒ giữ nguyên. */
  legal_warn_threshold: z.number().int().min(0).max(1_000_000_000_000_000).optional(),
});
export type CompanyIn = z.infer<typeof CompanySchema>;

/** CR-138 Q9: `GET /pack/contracts/company/cover` — ảnh bìa (data URL) hoặc null. */
export type CompanyCoverOut = { cover: string | null };

export type CompanyOut = {
  /** `has_cover`: đã có ảnh bìa (ảnh ở `/company/cover`); không có trong thân PUT (strict). */
  company: Omit<CompanyIn, "allow_negative_stock" | "legal_warn_threshold" | "cover"> & {
    has_cover: boolean;
  };
  allow_negative_stock: boolean;
  legal_warn_threshold: number;
  /** Mặc định của tenant (cài đặt công ty). */
  defaults: CompanyIn & { has_cover: boolean };
  version: number;
  updated_at: string | null;
};
