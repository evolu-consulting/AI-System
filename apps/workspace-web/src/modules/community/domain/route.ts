// COM-FR-31 · mô hình route Community (thuần). URL chuẩn nằm dưới `/community/*` (CR-118):
//   `/community` = Bảng tin · `/community/profile[/$orgId[/$section]]` = trang công ty (Hồ sơ cũ) ·
//   `/community/me[/$section]` = hồ sơ CÁ NHÂN (CR-129 L5).
// `section` do lát hồ sơ diễn giải (section lạ về Bài đăng ở đó). Hash cũ (`#/feed`…) ánh xạ ở `legacy-hash.ts`.
/** CR-120: `review` (hàng chờ duyệt bài) · `join` (yêu cầu tham gia) · `reports` (báo cáo vi phạm) = màn của 3 luồng. */
export const FLOW_ROUTES = ["review", "join", "reports"] as const;
export type FlowRouteName = (typeof FLOW_ROUTES)[number];
export type Route = {
  name: "feed" | "profile" | "me" | FlowRouteName;
  orgId?: string;
  section?: string;
};
export type Parsed = { route: Route };

import { COMMUNITY_BASE } from "./base";

export { COMMUNITY_BASE };

/** Đường dẫn chuẩn của route (không kèm query). Feed = gốc module. */
export function routeToPath(r: Route): string {
  if (r.name === "feed") return COMMUNITY_BASE;
  if (r.name === "me")
    return `${COMMUNITY_BASE}/me${r.section ? `/${encodeURIComponent(r.section)}` : ""}`;
  if (r.name !== "profile") return `${COMMUNITY_BASE}/${r.name}`;
  const org = r.orgId ? `/${encodeURIComponent(r.orgId)}` : "";
  const sec = r.orgId && r.section ? `/${encodeURIComponent(r.section)}` : "";
  return `${COMMUNITY_BASE}/profile${org}${sec}`;
}

/** Đường dẫn cho một route (CR-130: `?settings=1` đã chuyển sang redirect của shell). */
export const routeToHref = (r: Route): string => routeToPath(r);

const dec = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Đọc `pathname` (+ `search`) dưới `/community`; đường lạ về Bảng tin. */
export function parsePath(pathname: string): Parsed {
  const rest = pathname.replace(/\/+$/, "").slice(COMMUNITY_BASE.length);
  const [, name, orgId, section] = rest.split("/");
  const flow = FLOW_ROUTES.find((n) => n === name);
  if (flow) return { route: { name: flow } };
  if (name === "me") return { route: { name: "me", ...(orgId ? { section: dec(orgId) } : {}) } };
  if (name !== "profile") return { route: { name: "feed" } };
  return {
    route: {
      name: "profile",
      ...(orgId ? { orgId: dec(orgId) } : {}),
      ...(orgId && section ? { section: dec(section) } : {}),
    },
  };
}

/** Hồ sơ của chính mình (không orgId hoặc orgId = công ty mình)? */
export const isOwnProfile = (r: Route, ownOrgId: string): boolean =>
  r.name === "profile" && (!r.orgId || r.orgId === ownOrgId);
