// Vỏ mỏng tạm của community-web: giữ URL hash cũ (`#/feed`, `#/profile/<o>/<s>`, `#/settings`) cho tới khi router gộp CR-118
// (TanStack, đường dẫn `/community/*`) gắn module. Đọc hash qua `mapLegacyHash` → `parsePath` (một nguồn sự thật với module).
import type { RouterPort } from "../modules/community/application/ports";
import { mapLegacyHash } from "../modules/community/domain/legacy-hash";
import { parsePath, type Route } from "../modules/community/domain/route";

export const toHash = (r: Route): string =>
  `#/${r.name}${r.orgId ? `/${r.orgId}` : ""}${r.orgId && r.section ? `/${r.section}` : ""}`;

export const hashRouter: RouterPort = {
  read() {
    const [path = "/community", query = ""] = (mapLegacyHash(location.hash) ?? "/community").split(
      "?",
    );
    return parsePath(path, query);
  },
  go(r) {
    location.hash = toHash(r);
  },
  replace(r) {
    history.replaceState(null, "", toHash(r));
  },
  href: toHash,
  subscribe(cb) {
    addEventListener("hashchange", cb);
    return () => removeEventListener("hashchange", cb);
  },
};
