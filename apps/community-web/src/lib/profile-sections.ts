// CR-110 · COM-FR-35/36 · mô hình section của hồ sơ: khai báo + `canView` (false ⇒ KHÔNG render, không ẩn CSS).
// Chủ quản 4 tab (Giới thiệu, Bài đăng, Đối tác, Ảnh & tệp); đối tác 3 tab (D6/Q7). Thêm section = thêm một khai báo + component.
import type { PartnerOrg } from "@ai/contracts/community";

export type SectionId = "about" | "posts" | "partners" | "files";
export type SectionCtx = { isHostViewer: boolean };
export type SectionDef = {
  id: SectionId;
  /** Khoá i18n `community.profile.sections.<id>`. */
  labelKey: string;
  /** Nguồn dữ liệu của mục (tài liệu hoá; component ở ui/profile/sections.tsx). */
  source: "profile" | "feed" | "partners" | "media";
  canView: (c: SectionCtx) => boolean;
};

export const DEFAULT_SECTION: SectionId = "posts";

export const SECTIONS: readonly SectionDef[] = [
  {
    id: "about",
    labelKey: "community.profile.sections.about",
    source: "profile",
    canView: () => true,
  },
  {
    id: "posts",
    labelKey: "community.profile.sections.posts",
    source: "feed",
    canView: () => true,
  },
  {
    id: "partners",
    labelKey: "community.profile.sections.partners",
    source: "partners",
    canView: (c) => c.isHostViewer,
  },
  {
    id: "files",
    labelKey: "community.profile.sections.files",
    source: "media",
    canView: () => true,
  },
];

export const visibleSections = (c: SectionCtx): SectionDef[] =>
  SECTIONS.filter((s) => s.canView(c));

/** `#/profile/<id>/<section>`: section lạ hoặc không được xem ⇒ Bài đăng (P3-AC04). */
export function resolveSection(raw: string | undefined, c: SectionCtx): SectionId {
  return visibleSections(c).find((s) => s.id === raw)?.id ?? DEFAULT_SECTION;
}

/** Số "Bạn bè": chỉ chủ quản và chỉ khi server trả (đối tác không bao giờ thấy). */
export const friendsStat = (friends: number | undefined, c: SectionCtx): number | undefined =>
  c.isHostViewer ? friends : undefined;

/** Cột uy tín chỉ khi ít nhất một đối tác có `reputation` (server chỉ trả cho chủ quản có quyền contracts). */
export const hasReputation = (partners: readonly PartnerOrg[]): boolean =>
  partners.some((p) => p.reputation !== undefined);
