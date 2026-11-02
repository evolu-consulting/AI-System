// COM-FR-31 · định tuyến hash: `#/feed`, `#/profile[/orgId][/section]`. `#/settings` (link cũ) = Bảng tin + hộp thoại Cài đặt
// (không còn view `settings`). `section` do lát hồ sơ (cr110-profile-ui) diễn giải; section lạ về Bài đăng ở đó.
export type Route = { name: "feed" | "profile"; orgId?: string; section?: string };
export type Parsed = { route: Route; settings: boolean };

export function parseLocation(h: string): Parsed {
  const [, name, orgId, section] = h.replace(/^#/, "").split("/");
  if (name === "settings") return { route: { name: "feed" }, settings: true };
  if (name === "profile") {
    return {
      route: {
        name: "profile",
        ...(orgId ? { orgId } : {}),
        ...(orgId && section ? { section } : {}),
      },
      settings: false,
    };
  }
  return { route: { name: "feed" }, settings: false };
}

export const parseHash = (h: string): Route => parseLocation(h).route;

export const hashOf = (r: Route): string =>
  `#/${r.name}${r.orgId ? `/${r.orgId}` : ""}${r.orgId && r.section ? `/${r.section}` : ""}`;

/** Hồ sơ của chính mình (không orgId hoặc orgId = công ty mình)? */
export const isOwnProfile = (r: Route, ownOrgId: string): boolean =>
  r.name === "profile" && (!r.orgId || r.orgId === ownOrgId);
