// hien-thi.md §1–2 · ai thấy bài nào. Chỉ adapter mock dùng (server C3 là nguồn thật); UI không tự lọc.
import type { CommunityViewer, PostAudience, PostStatus, PostType } from "@ai/contracts/community";
import { isHost } from "@ai/contracts/community";

export type VisPost = {
  type: PostType;
  authorOrgId: string;
  authorSide: "host" | "partner";
  status: PostStatus;
  hidden: boolean;
  cats: string[];
  audience: PostAudience;
};

/** Mặc định D2: Cần bán ⇒ người mua nhóm hàng đó; Cần mua ⇒ NCC nhóm hàng đó; Thông báo ⇒ tất cả bạn bè. */
export function defaultAudience(type: PostType): PostAudience {
  return { mode: type === "note" ? "all" : "cats", cats: [], companies: [] };
}

/** Công ty `v` hợp với audience của bài chủ quản? (đã qua kiểm "trần = bạn bè": mọi viewer partner đều là bạn bè). */
export function audienceIncludes(
  a: PostAudience,
  type: PostType,
  postCats: string[],
  v: Pick<CommunityViewer, "orgId" | "labels" | "cats">,
): boolean {
  switch (a.mode) {
    case "all":
      return true;
    case "suppliers":
      return v.labels.includes("supplier");
    case "buyers":
      return v.labels.includes("buyer");
    case "companies":
      return a.companies.includes(v.orgId);
    case "cats": {
      const wanted = a.cats.length > 0 ? a.cats : postCats;
      const interested = v.cats.some((c) => wanted.includes(c));
      if (type === "sell") return interested && v.labels.includes("buyer");
      if (type === "buy") return interested && v.labels.includes("supplier");
      return interested;
    }
  }
}

export function canViewPost(p: VisPost, v: CommunityViewer): boolean {
  if (isHost(v)) return true;
  if (p.authorOrgId === v.orgId) return true; // bài của mình (kể cả đã bị chủ quản ẩn: HT-30 mặc định)
  if (p.authorSide !== "host") return false; // bài đối tác khác ⇒ chỉ chủ quản
  if (p.status !== "active" || p.hidden) return false;
  return audienceIncludes(p.audience, p.type, p.cats, v);
}
