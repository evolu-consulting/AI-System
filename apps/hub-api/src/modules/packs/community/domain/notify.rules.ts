// CR-102 · com-c9 · luật thuần chuông Community (nghiep-vu §10): ai nhận loại nào, chữ + đường dẫn + khoá chống trùng của từng loại.
// Lớp 1 — chỉ built-in. Visibility (người nhận có THẤY nội dung không) do SQL tính (cùng `community.audience_ok` của RLS) rồi đưa vào
// đây dưới dạng `sees`; không ai nhận thông báo về thứ họ không thấy.
import { canSeeComment } from "./comment-visibility.rules";

export const NOTIFY_KIND_LIST = [
  "comment",
  "reply",
  "mention",
  "newSell",
  "newBuy",
  "matchBuy",
  "priceEdited",
  "expiring",
  "digest",
] as const;
export type BellKind = (typeof NOTIFY_KIND_LIST)[number];

/** Khoá `kind` trong chuông kit (`^[a-z][a-z0-9_.]{1,40}$`). */
export const BELL_PREFIX = "community.";
const snake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
/** camelCase của contract → snake_case (chuông kit chỉ nhận chữ thường). */
export const bellKind = (k: BellKind): string => `${BELL_PREFIX}${snake(k)}`;
export const kindOfBell = (s: string): BellKind | null =>
  s.startsWith(BELL_PREFIX) ? (NOTIFY_KIND_LIST.find((k) => bellKind(k) === s) ?? null) : null;

/** Mặc định mỗi loại (nghiep-vu §10): Bật, riêng tổng hợp hằng ngày Tắt. Trùng hàm SQL `community.notify_wanted`. */
export const defaultOn = (k: BellKind): boolean => k !== "digest";

/** Tuỳ chọn hiệu lực = mặc định + ghi đè của người dùng (giá trị không phải boolean bị bỏ qua). */
export function wantsKind(
  notify: Record<string, unknown> | null | undefined,
  k: BellKind,
): boolean {
  const v = notify?.[k];
  return typeof v === "boolean" ? v : defaultOn(k);
}

export type Cand = { userId: string; kind: BellKind };

/** Một ứng viên nhận bình luận: người đăng bài, người từng bình luận trên bài, hoặc người của công ty được nhắc (@). */
export type CommentCand = {
  userId: string;
  /** null = chủ quản. */
  org: string | null;
  role: "author" | "commenter" | "mentioned";
  /** Người này THẤY bài (SQL: cùng luật RLS posts_visible, công ty còn hiệu lực). */
  sees: boolean;
};

const ROLE_KIND = { mentioned: "mention", author: "comment", commenter: "reply" } as const;
const KIND_RANK: Record<string, number> = { mention: 3, comment: 2, reply: 1 };

/**
 * Người nhận khi có bình luận mới trên một bài (CR-129, bình luận phẳng):
 * - công ty được nhắc (`mentions`) ⇒ `mention`; người đăng bài ⇒ `comment`; người từng bình luận trên bài ⇒ `reply`;
 *   một người một chuông mỗi bình luận, ưu tiên mention > comment > reply;
 * - không bao giờ gửi cho chính người viết;
 * - chỉ người THẤY bài (`sees`) VÀ thấy bình luận mới (`canSeeComment`: bạn của người viết | bài của mình | được nhắc) — đối tác
 *   không nhận chuông về bình luận của đối tác khác; chủ quản thấy mọi bình luận nhưng chỉ khi CÒN quyền đọc gói (`sees`).
 */
export function commentRecipients(
  cands: readonly CommentCand[],
  c: { actorOrg: string | null; postAuthorOrg: string | null; mentions: readonly string[] },
  actorUserId: string,
): Cand[] {
  const out = new Map<string, Cand>();
  const ctx = {
    authorOrg: c.actorOrg,
    postAuthorOrg: c.postAuthorOrg,
    mentions: c.mentions,
    hidden: false,
  };
  for (const x of cands) {
    if (x.userId === actorUserId || !x.sees || !canSeeComment(x.org, ctx)) continue;
    const kind: BellKind = ROLE_KIND[x.role];
    const cur = out.get(x.userId);
    if (!cur || (KIND_RANK[kind] ?? 0) > (KIND_RANK[cur.kind] ?? 0))
      out.set(x.userId, { userId: x.userId, kind });
  }
  return [...out.values()];
}

/** Bài mới của đối tác ⇒ loại chuông cho chủ quản (bài chủ quản đăng và Ghi chú: không có). */
export function newPostKind(p: { type: string; authorOrg: string | null }): BellKind | null {
  if (p.authorOrg === null) return null;
  return p.type === "sell" ? "newSell" : p.type === "buy" ? "newBuy" : null;
}

/** Giá sửa thật sự (khác sau khi chuẩn hoá khoảng trắng); cả hai rỗng = không sửa. */
export function priceChanged(before: string | null | undefined, after: string | null | undefined) {
  const n = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
  return n(before) !== n(after);
}

export type PostRef = { id: string; title: string };
/** Trích tiêu đề bài tối đa 60 ký tự Unicode: “…” (bài không tiêu đề ⇒ rỗng, câu dùng bản không trích — không in «(không tiêu đề)»). */
export function titleQuote(s: string): string {
  const t = Array.from(s.trim());
  return t.length === 0 ? "" : `“${t.slice(0, 60).join("")}”`;
}

export type BellText = { title: string; body: string; link: string; dedup: string };

/** Chữ + link + khoá trùng. `body` = tên người gây ra sự kiện (chuông hiển thị `actorName`). Tiêu đề bài luôn là bản đã che. */
export function bellText(k: BellKind, p: PostRef, o: { actor: string; ref: string }): BellText {
  const post = `/community?post=${p.id}`; // đường dẫn trong app (chuông chung của shell): Bảng tin cuộn tới đúng bài
  const t = titleQuote(p.title);
  /** Có trích ⇒ `<có>: “…”`; không ⇒ `<không>`. */
  const q = (withT: string, without: string): string => (t ? `${withT}: ${t}` : without);
  switch (k) {
    case "comment":
      return {
        title: q(`${o.actor} bình luận bài`, `${o.actor} bình luận một bài đăng`),
        body: "",
        link: `${post}&comment=${o.ref}`,
        dedup: `c:${o.ref}:comment`,
      };
    case "reply":
      return {
        title: q(
          `${o.actor} trả lời bình luận của bạn trong bài`,
          `${o.actor} trả lời bình luận của bạn`,
        ),
        body: "",
        link: `${post}&comment=${o.ref}`,
        dedup: `c:${o.ref}:reply`,
      };
    case "mention":
      return {
        title: q(
          `${o.actor} nhắc đến công ty bạn trong bài`,
          `${o.actor} nhắc đến công ty bạn trong một bài đăng`,
        ),
        body: "",
        link: `${post}&comment=${o.ref}`,
        dedup: `c:${o.ref}:mention`,
      };
    case "newSell":
      return {
        title: q(`${o.actor} đăng bài Cần bán`, `${o.actor} đăng một bài Cần bán`),
        body: "",
        link: post,
        dedup: `p:${o.ref}:newSell`,
      };
    case "newBuy":
      return {
        title: q(`${o.actor} đăng bài Cần mua`, `${o.actor} đăng một bài Cần mua`),
        body: "",
        link: post,
        dedup: `p:${o.ref}:newBuy`,
      };
    case "matchBuy":
      return {
        title: q(
          "Bài Cần mua khớp sản phẩm bạn đang có",
          "Có bài Cần mua khớp sản phẩm bạn đang có",
        ),
        body: "",
        link: post,
        dedup: `p:${o.ref}:matchBuy`,
      };
    case "priceEdited":
      return {
        title: q(
          `${o.actor} sửa giá bài bạn đã lưu báo giá`,
          `${o.actor} sửa giá bài bạn đã lưu báo giá`,
        ),
        body: "",
        link: `${post}&quote=1`,
        dedup: `pe:${p.id}:${o.ref}`,
      };
    case "expiring":
      return {
        title: q("Bài sắp tự hết hạn sau 3 ngày", "Bài của bạn sẽ tự hết hạn sau 3 ngày"),
        body: "",
        link: post,
        dedup: `x:${p.id}:${o.ref}`,
      };
    case "digest":
      return { title: o.actor, body: "", link: "/community", dedup: `d:${o.ref}` };
  }
}

/** Tổng hợp hằng ngày: gửi lúc `hour` giờ địa phương (mặc định 8). */
export function digestDue(now: Date, tz: string, hour = 8): { due: boolean; day: string } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { due: Number(p.hour) >= hour, day: `${p.year}-${p.month}-${p.day}` };
}
