// COM-FR-27/45 · brand công ty chủ quản (`GET /pack/community/brand`) → dữ liệu vẽ topbar. Chưa có brand (lỗi/đang tải) ⇒ chữ cái
// đầu của tên công ty + indigo; app vẫn chạy (P5-AC07). Màu nhấn đi qua token `data-accent` có sẵn (globals.css).
import {
  COMMUNITY_BRAND_ACCENTS,
  type CommunityBrand,
  type CommunityBrandAccent,
  DEFAULT_BRAND_ACCENT,
} from "@ai/contracts/community";
import { initials } from "./format";

export type BrandView = {
  name: string;
  /** Dòng phụ dưới tên (tên ứng dụng của công ty); null = không vẽ. */
  appName: string | null;
  /** Data URL ảnh logo; null ⇒ vẽ `initial`. */
  logo: string | null;
  initial: string;
  accent: CommunityBrandAccent;
};

const isAccent = (v: unknown): v is CommunityBrandAccent =>
  (COMMUNITY_BRAND_ACCENTS as readonly unknown[]).includes(v);

/** Chỉ nhận data URL ảnh (server đã kiểm; phòng thủ thêm để `<img src>` không nhận URL lạ). */
const safeLogo = (v: string | null): string | null =>
  v && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(v) ? v : null;

/** CR-138 Q9 · chỉ nhận data URL ảnh bìa PNG/JPG/WebP (server đã kiểm; phòng thủ thêm để `<img src>` không nhận URL lạ). */
export const safeCover = (v: string | null | undefined): string | null =>
  v && /^data:image\/(png|jpeg|webp);base64,/i.test(v) ? v : null;

export function toBrandView(b: CommunityBrand | null, fallbackName: string): BrandView {
  const name = b?.name?.trim() || fallbackName;
  return {
    name,
    appName: b?.appName?.trim() || null,
    logo: b ? safeLogo(b.logo) : null,
    initial: initials(name),
    accent: b && isAccent(b.accent) ? b.accent : DEFAULT_BRAND_ACCENT,
  };
}
