// CR-102 · com-c9 · luật thuần chuông Community (nghiep-vu §10): ai nhận loại nào, chữ + đường dẫn + khoá chống trùng của từng loại.
// Lớp 1 — chỉ built-in. Visibility (người nhận có THẤY nội dung không) do SQL tính (cùng `community.audience_ok` của RLS) rồi đưa vào
// đây dưới dạng `sees`; không ai nhận thông báo về thứ họ không thấy.

export const NOTIFY_KIND_LIST = [
  "comment",
  "reply",
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

/** Một ứng viên nhận bình luận: người đăng bài hoặc người từng bình luận trong luồng. */
export type CommentCand = {
  userId: string;
  /** null = chủ quản. */
  org: string | null;
  role: "author" | "commenter";
  /** Người này THẤY bài (SQL: cùng luật RLS posts_visible, công ty còn hiệu lực). */
  sees: boolean;
};

/**
 * Người nhận khi có bình luận mới trong luồng `threadOrg` của một bài:
 * - người đăng bài ⇒ `comment`; người từng bình luận trong luồng ⇒ `reply` (người đăng không nhận hai lần);
 * - không bao giờ gửi cho chính người viết;
 * - đối tác chỉ nhận khi luồng là của công ty mình VÀ còn thấy bài; chủ quản luôn thấy mọi luồng.
 */
export function commentRecipients(
  cands: readonly CommentCand[],
  threadOrg: string,
  actorUserId: string,
): Cand[] {
  const out = new Map<string, Cand>();
  for (const c of cands) {
    if (c.userId === actorUserId) continue;
    if (c.org !== null && (c.org !== threadOrg || !c.sees)) continue;
    const kind: BellKind = c.role === "author" ? "comment" : "reply";
    if (!out.has(c.userId) || kind === "comment") out.set(c.userId, { userId: c.userId, kind });
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
const quote = (s: string) => (s.trim() === "" ? "(không tiêu đề)" : `"${s.trim().slice(0, 60)}"`);

export type BellText = { title: string; body: string; link: string; dedup: string };

/** Chữ + link + khoá trùng. `body` = tên người gây ra sự kiện (chuông hiển thị `actorName`). Tiêu đề bài luôn là bản đã che. */
export function bellText(
  k: BellKind,
  p: PostRef,
  o: { actor: string; threadOrg?: string; ref: string },
): BellText {
  const post = `/posts/${p.id}`;
  const t = quote(p.title);
  switch (k) {
    case "comment":
      return {
        title: `${o.actor} bình luận bài ${t}`,
        body: o.actor,
        link: `${post}/threads/${o.threadOrg}`,
        dedup: `c:${o.ref}:comment`,
      };
    case "reply":
      return {
        title: `${o.actor} trả lời bình luận của bạn trong bài ${t}`,
        body: o.actor,
        link: `${post}/threads/${o.threadOrg}`,
        dedup: `c:${o.ref}:reply`,
      };
    case "newSell":
      return {
        title: `${o.actor} đăng bài Cần bán ${t}`,
        body: o.actor,
        link: post,
        dedup: `p:${o.ref}:newSell`,
      };
    case "newBuy":
      return {
        title: `${o.actor} đăng bài Cần mua ${t}`,
        body: o.actor,
        link: post,
        dedup: `p:${o.ref}:newBuy`,
      };
    case "matchBuy":
      return {
        title: `Bài Cần mua ${t} khớp sản phẩm bạn đang có`,
        body: o.actor,
        link: post,
        dedup: `p:${o.ref}:matchBuy`,
      };
    case "priceEdited":
      return {
        title: `${o.actor} sửa giá bài ${t} mà bạn đã lưu báo giá`,
        body: o.actor,
        link: `${post}?quote=1`,
        dedup: `pe:${p.id}:${o.ref}`,
      };
    case "expiring":
      return {
        title: `Bài ${t} sẽ tự hết hạn sau 3 ngày`,
        body: "",
        link: post,
        dedup: `x:${p.id}:${o.ref}`,
      };
    case "digest":
      return { title: o.actor, body: "", link: "/?digest=1", dedup: `d:${o.ref}` };
  }
}

/** Chuông kit → hình `CommunityNotification` của contract (kind ngoài 8 loại ⇒ null, bỏ qua). */
export function bellView(r: {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  read: boolean;
}) {
  const kind = kindOfBell(r.kind);
  if (!kind) return null;
  const m = /^\/posts\/([0-9a-f-]{36})(?:\/threads\/([0-9a-f-]{36}))?/i.exec(r.link ?? "");
  return {
    id: r.id,
    kind,
    actorName: r.body,
    text: r.title,
    ...(m?.[1] ? { postId: m[1] } : {}),
    ...(m?.[2] ? { orgId: m[2] } : {}),
    createdAt: r.created_at,
    unread: !r.read,
  };
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
