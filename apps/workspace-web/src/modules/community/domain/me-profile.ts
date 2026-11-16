// CR-129 L5 · hồ sơ CÁ NHÂN (`/community/me`): tab «Bài đăng của tôi» (lọc theo người) + «Bài đăng của tổ chức» (lọc theo công ty);
// công ty chỉ là khối phụ. Thuần, không I/O.
import type { CommunityViewer, FeedQuery } from "@ai/contracts/community";

export const ME_SECTIONS = ["mine", "org"] as const;
export type MeSection = (typeof ME_SECTIONS)[number];
export const DEFAULT_ME_SECTION: MeSection = "mine";

/** Section lạ/thiếu ⇒ «Bài đăng của tôi». */
export const resolveMeSection = (raw: string | undefined): MeSection =>
  ME_SECTIONS.find((s) => s === raw) ?? DEFAULT_ME_SECTION;

/** Bộ lọc cố định của feed theo tab: người (userId) hoặc công ty (chủ quản = bài chủ quản; đối tác = công ty mình). */
export function meFeedFixed(
  s: MeSection,
  userId: string,
): Pick<FeedQuery, "mine" | "authorUserId"> {
  return s === "mine" ? { authorUserId: userId } : { mine: true };
}

/** Khoá i18n vai của người xem (nhãn nghiệp vụ). */
export const meRoleKey = (role: CommunityViewer["role"]): string => `community.me.role.${role}`;

/** Chỉ hiện Composer ở tab «Bài đăng của tôi» (đăng bài là việc của chính mình). */
export const meShowsComposer = (s: MeSection): boolean => s === "mine";

/** Dòng phụ «chức vụ · phòng ban»: thiếu phần nào bỏ phần đó (không «·» thừa); cả hai thiếu ⇒ chuỗi rỗng. */
export function meSubtitle(
  jobTitle: string | null | undefined,
  department: string | null | undefined,
): string {
  return [jobTitle, department]
    .map((x) => x?.trim() ?? "")
    .filter((x) => x !== "")
    .join(" · ");
}
