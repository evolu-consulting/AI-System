// COM-FR-31 (MODIFIED, CR-118) · hash cũ của community-web → đường dẫn chuẩn `/community/*` (thuần, không đụng `location`).
//   #/feed → /community · #/profile[/<o>[/<s>]] → /community/profile[/<o>[/<s>]] · #/settings → /community?settings=1
// Hash rỗng / không phải dạng `#/…` ⇒ null (không có gì để ánh xạ); tên lạ ⇒ Bảng tin (như router hash cũ).
import { COMMUNITY_BASE } from "./base";

export function mapLegacyHash(hash: string): string | null {
  if (!hash.startsWith("#/")) return null;
  const [name, orgId, section] = hash.slice(2).split("/");
  if (name === "settings") return `${COMMUNITY_BASE}?settings=1`;
  if (name !== "profile") return COMMUNITY_BASE;
  return `${COMMUNITY_BASE}/profile${orgId ? `/${orgId}` : ""}${orgId && section ? `/${section}` : ""}`;
}
