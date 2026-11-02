// CR-110 · COM-FR-45 · brand dùng chung (`GET /pack/community/brand`): nhận diện công ty CHỦ QUẢN (nguồn `/pack/contracts/company`,
// đọc qua cổng `CompanyBrandReader`, ADR-0031) cho MỌI account trong tenant, kể cả đối tác. Đúng 4 trường — không pháp nhân/MST/
// giao diện/cờ duyệt (P5-AC06). Chưa có brand ⇒ tên tenant + indigo, logo null (UI vẽ chữ cái đầu, P5-AC07).
import { z } from "zod";

/** 6 màu công ty (khớp `COMPANY_ACCENTS` của gói contracts; community thêm `rose`). */
export const COMMUNITY_BRAND_ACCENTS = [
  "indigo",
  "blue",
  "teal",
  "green",
  "orange",
  "rose",
] as const;
export type CommunityBrandAccent = (typeof COMMUNITY_BRAND_ACCENTS)[number];
export const DEFAULT_BRAND_ACCENT: CommunityBrandAccent = "indigo";

export const CommunityBrandSchema = z.strictObject({
  /** Tên công ty (`/company.name`); chưa đặt ⇒ tên tenant. */
  name: z.string().min(1),
  /** Tên ứng dụng (`/company.app_name`); null = chưa đặt. */
  appName: z.string().nullable(),
  /** Logo data URL (`data:image/...;base64,...`, ≤ 1 MB ảnh gốc); null ⇒ chữ cái đầu của `name`. */
  logo: z.string().nullable(),
  accent: z.enum(COMMUNITY_BRAND_ACCENTS),
});
export type CommunityBrand = z.infer<typeof CommunityBrandSchema>;

/** Quyền theo gói của người xem (I3). `contracts` = có quyền đọc gói contracts (chủ quản); đối tác luôn false. */
export const CommunityCapsSchema = z.strictObject({
  contracts: z.boolean(),
});
export type CommunityCaps = z.infer<typeof CommunityCapsSchema>;
