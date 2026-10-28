// CR-102 · com-c3 · D2 · hien-thi.md §1–2, §5: luật thuần người xem + việc được làm trên bài. Lớp 1 (không import).
// `audienceIncludes` TRÙNG hàm SQL `community.audience_ok` (migration community 0001) — RLS là nguồn thật; hàm này dùng để
// xem trước / unit test và giữ hai bên khớp nhau.

export type PostType = "sell" | "buy" | "note";
export type Label = "supplier" | "buyer";
export type AudienceMode = "all" | "suppliers" | "buyers" | "cats" | "companies";
export type Audience = {
  mode: AudienceMode;
  cats: readonly string[];
  companies: readonly string[];
};
export type PostStatus = "active" | "archived" | "done" | "expired";
export type PostAction =
  | "edit"
  | "archive"
  | "unarchive"
  | "done"
  | "delete"
  | "hide"
  | "unhide"
  | "saveQuote";

/** Người xem: `org = null` ⇔ chủ quản (thành viên tenant). */
export type Viewer = { org: string | null; labels: readonly Label[]; cats: readonly string[] };

/** Mặc định D2: Cần bán ⇒ người mua nhóm hàng của bài; Cần mua ⇒ NCC nhóm hàng đó; Thông báo ⇒ tất cả bạn bè. */
export function defaultAudience(type: PostType): Audience {
  return { mode: type === "note" ? "all" : "cats", cats: [], companies: [] };
}

/** Công ty đối tác `v` thuộc audience của bài chủ quản? (trần = bạn bè: mọi đối tác còn hiệu lực đều là bạn bè). */
export function audienceIncludes(
  a: Audience,
  type: PostType,
  postCats: readonly string[],
  v: { org: string; labels: readonly Label[]; cats: readonly string[] },
): boolean {
  switch (a.mode) {
    case "all":
      return true;
    case "suppliers":
      return v.labels.includes("supplier");
    case "buyers":
      return v.labels.includes("buyer");
    case "companies":
      return a.companies.includes(v.org);
    case "cats": {
      const wanted = a.cats.length > 0 ? a.cats : postCats;
      if (!v.cats.some((c) => wanted.includes(c))) return false;
      if (type === "sell") return v.labels.includes("buyer");
      if (type === "buy") return v.labels.includes("supplier");
      return true;
    }
  }
}

/** Đối tác đăng được loại bài này? Cần bán: nhãn NCC; Cần mua: nhãn người mua; Thông báo: chỉ chủ quản. */
export function partnerMayPost(type: PostType, labels: readonly Label[]): boolean {
  if (type === "sell") return labels.includes("supplier");
  if (type === "buy") return labels.includes("buyer");
  return false;
}

/** Trạng thái hiển thị: `active` quá hạn 30 ngày ⇒ `expired` (tự lưu trữ). */
export function effectiveStatus(
  status: "active" | "archived" | "done",
  expiresAt: Date,
  now: Date,
): PostStatus {
  return status === "active" && expiresAt.getTime() <= now.getTime() ? "expired" : status;
}

export type ActionPost = {
  type: PostType;
  authorOrg: string | null;
  status: PostStatus;
  hidden: boolean;
};

/**
 * Việc người xem được làm (server tính, UI chỉ hiện). Bài của bên mình (cùng công ty / cùng phía chủ quản): sửa, lưu trữ/bỏ
 * lưu trữ, đã xong, xoá. Chủ quản trên bài đối tác: ẩn/bỏ ẩn + Lưu báo giá (chỉ Cần bán). Đối tác KHÔNG BAO GIỜ có
 * `saveQuote`/`hide` (HT-64).
 */
export function postActions(p: ActionPost, v: Pick<Viewer, "org">): PostAction[] {
  const own = p.authorOrg === v.org;
  if (own) {
    const out: PostAction[] = ["edit", p.status === "active" ? "archive" : "unarchive"];
    if (p.status === "active" && p.type !== "note") out.push("done");
    out.push("delete");
    return out;
  }
  if (v.org !== null) return [];
  const out: PostAction[] = [p.hidden ? "unhide" : "hide"];
  if (p.type === "sell") out.push("saveQuote");
  return out;
}
