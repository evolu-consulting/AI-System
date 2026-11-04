// COM-FR-31 · mô hình route Community (thuần). URL chuẩn nằm dưới `/community/*` (CR-118):
//   `/community` = Bảng tin · `/community/profile[/$orgId[/$section]]` = Hồ sơ · `?settings=1` mở hộp thoại Cài đặt.
// `section` do lát hồ sơ diễn giải (section lạ về Bài đăng ở đó). Hash cũ (`#/feed`…) ánh xạ ở `legacy-hash.ts`.
export type Route = { name: "feed" | "profile"; orgId?: string; section?: string };
export type Parsed = { route: Route; settings: boolean };

export const COMMUNITY_BASE = "/community";

/** Đường dẫn chuẩn của route (không kèm query). Feed = gốc module. */
export function routeToPath(r: Route): string {
  if (r.name === "feed") return COMMUNITY_BASE;
  const org = r.orgId ? `/${encodeURIComponent(r.orgId)}` : "";
  const sec = r.orgId && r.section ? `/${encodeURIComponent(r.section)}` : "";
  return `${COMMUNITY_BASE}/profile${org}${sec}`;
}

/** Đường dẫn + query cho một route (có `settings` ⇒ `?settings=1`). */
export const routeToHref = (r: Route, settings = false): string =>
  routeToPath(r) + (settings ? "?settings=1" : "");

const dec = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Đọc `pathname` (+ `search`) dưới `/community`; đường lạ về Bảng tin. */
export function parsePath(pathname: string, search = ""): Parsed {
  const settings = new URLSearchParams(search).get("settings") === "1";
  const rest = pathname.replace(/\/+$/, "").slice(COMMUNITY_BASE.length);
  const [, name, orgId, section] = rest.split("/");
  if (name !== "profile") return { route: { name: "feed" }, settings };
  return {
    route: {
      name: "profile",
      ...(orgId ? { orgId: dec(orgId) } : {}),
      ...(orgId && section ? { section: dec(section) } : {}),
    },
    settings,
  };
}

/** Hồ sơ của chính mình (không orgId hoặc orgId = công ty mình)? */
export const isOwnProfile = (r: Route, ownOrgId: string): boolean =>
  r.name === "profile" && (!r.orgId || r.orgId === ownOrgId);
