// CR-102 · com-c9 · `communityEvents.emit*`: phát chuông Community SAU COMMIT của hành động (mẫu outbox của rooms: service trả dữ
// liệu sự kiện, gọi emit khi tx đã đóng). Không giữ kết nối của tx nghiệp vụ trong lúc hỏi chủ quản / sổ SHT ⇒ không cạn pool (review
// cuối đợt Cao-1/TB-2). Mỗi lần phát = các bước tuần tự, số câu cố định: (chủ quản: 1 tx hub) + (khớp hàng: 1 tx contracts) + MỘT tx
// gói: ứng viên + tuỳ chọn + MỘT `notify.enqueue` cho cả lô — không vòng lặp từng người nhận. Lỗi phát chỉ log, không làm hỏng hành động.
import type { Tx } from "@ai/db";
import type { Notifier } from "../../kit/application/notify";
import type { PackSystemUow } from "../../kit/application/ports";
import {
  type BellKind,
  bellKind,
  bellText,
  type Cand,
  commentRecipients,
  newPostKind,
} from "../domain/notify.rules";
import { commentCandidates, wantedOnly } from "./notify.repo";
import { savedUsers } from "./quote.repo";

/** Phần repo trong tx mà `PackUow` đưa cho gói (`notify` do bộ khung ghép sẵn). */
export type EventTx = { tx: Tx; notify: Notifier };
export type Actor = { userId: string; name: string };

export type CommunityEventDeps = {
  /** Tx hệ thống của gói (theo tenant) để ghi chuông sau commit. */
  uow: PackSystemUow<EventTx>;
  /** Chủ quản (user nội bộ có quyền đọc gói) của tenant — một câu. */
  hosts: (tenantId: string) => Promise<readonly string[]>;
  /** Ghi đè nguồn "chủ quản đã LƯU BÁO GIÁ" (test); vắng ⇒ bảng `quote_saves` trong tx phát. */
  savedBy?: (tenantId: string, postId: string) => Promise<readonly string[]>;
  /** Người có quyền đọc SHT đang có hàng khớp bài Cần mua (`HostBookReader.stockHolders`); vắng ⇒ `matchBuy` không phát. */
  stockMatch?: (tenantId: string, product: string) => Promise<readonly string[]>;
  now?: () => Date;
  warn?: (m: string, meta: Record<string, unknown>) => void;
};

type Item = { c: Cand; post: { id: string; title: string }; o: Parameters<typeof bellText>[2] };

const CHUNK = 500; // trần lô của `notify.enqueue`

/** Lọc theo tuỳ chọn rồi ghi chuông cho cả lô. Trả số thông báo MỚI. */
export async function deliver(r: EventTx, items: readonly Item[]): Promise<number> {
  if (items.length === 0) return 0;
  const ok = await wantedOnly(
    r.tx,
    items.map((i) => i.c),
  );
  const key = (c: Cand) => `${c.userId}|${c.kind}`;
  const want = new Set(ok.map(key));
  const rows = items
    .filter((i) => want.has(key(i.c)))
    .map((i) => {
      const t = bellText(i.c.kind, i.post, i.o);
      return {
        user_id: i.c.userId,
        kind: bellKind(i.c.kind),
        title: t.title.slice(0, 200),
        body: t.body.slice(0, 2000),
        link: t.link,
        dedup_key: t.dedup,
      };
    });
  let n = 0;
  for (let i = 0; i < rows.length; i += CHUNK)
    n += await r.notify.enqueue(rows.slice(i, i + CHUNK));
  return n;
}

const toItems = (
  users: readonly string[],
  kind: BellKind,
  post: { id: string; title: string },
  o: Item["o"],
): Item[] => users.map((userId) => ({ c: { userId, kind }, post, o }));

export type CommentEvent = {
  tenantId: string;
  postId: string;
  threadOrg: string;
  commentId: string;
  actor: Actor;
  /** Công ty đối tác CÒN hiệu lực (danh bạ) — đối tác của công ty đã rời / vắng không nhận. */
  activeOrgs: readonly string[];
};
export type NewPostEvent = {
  tenantId: string;
  postId: string;
  type: string;
  authorOrg: string | null;
  authorUserId: string;
  actorName: string;
  titleMasked: string;
  product?: string;
};
export type PriceEditedEvent = {
  tenantId: string;
  postId: string;
  authorOrg: string | null;
  actorName: string;
  titleMasked: string;
  price: string;
};

export function communityEvents(d: CommunityEventDeps) {
  /** Phát sau commit: lỗi chỉ log (hành động đã xong), trả 0. */
  const safely = async (
    event: string,
    i: { tenantId: string; postId: string },
    f: () => Promise<number>,
  ) => {
    try {
      return await f();
    } catch (e) {
      d.warn?.("community-notify-failed", {
        event,
        tenant_id: i.tenantId,
        post_id: i.postId,
        error: e instanceof Error ? e.name : "unknown",
      });
      return 0;
    }
  };

  return {
    /** Bình luận mới (đã commit): người đăng ⇒ comment; người từng bình luận ⇒ reply; chỉ chủ quản còn quyền + đối tác còn hiệu lực thấy bài. */
    emitComment: (i: CommentEvent): Promise<number> =>
      safely("comment", i, async () => {
        const hosts = await d.hosts(i.tenantId);
        return d.uow.system(i.tenantId, async (r) => {
          const { title, cands } = await commentCandidates(r.tx, {
            tenantId: i.tenantId,
            postId: i.postId,
            threadOrg: i.threadOrg,
            actorUserId: i.actor.userId,
            at: d.now?.() ?? new Date(),
            activeOrgs: i.activeOrgs,
            hosts,
          });
          const post = { id: i.postId, title };
          const o = { actor: i.actor.name, threadOrg: i.threadOrg, ref: i.commentId };
          return deliver(
            r,
            commentRecipients(cands, i.threadOrg, i.actor.userId).map((c) => ({ c, post, o })),
          );
        });
      }),

    /** Bài mới của đối tác (đã commit) ⇒ chủ quản (newSell/newBuy) + (Cần mua khớp hàng đang có) matchBuy. Tiêu đề = bản đã che. */
    emitNewPost: (i: NewPostEvent): Promise<number> =>
      safely("newPost", i, async () => {
        const kind = newPostKind({ type: i.type, authorOrg: i.authorOrg });
        if (!kind) return 0;
        const post = { id: i.postId, title: i.titleMasked };
        const o = { actor: i.actorName, ref: i.postId };
        const hosts = await d.hosts(i.tenantId);
        if (hosts.length === 0) return 0;
        const have =
          kind === "newBuy" && d.stockMatch && i.product
            ? new Set(await d.stockMatch(i.tenantId, i.product).catch(() => []))
            : new Set<string>();
        // chủ quản khớp hàng nhận matchBuy THAY cho newBuy (một bài ⇒ một thông báo mỗi người)
        const items = [
          ...toItems(
            hosts.filter((h) => !have.has(h)),
            kind,
            post,
            o,
          ),
          ...toItems(
            hosts.filter((h) => have.has(h)),
            "matchBuy",
            post,
            o,
          ),
        ];
        return d.uow.system(i.tenantId, (r) => deliver(r, items));
      }),

    /** NCC sửa giá bài đã lưu báo giá (đã commit) ⇒ CHỈ chủ quản đã lưu (R29: không gửi gì cho NCC). `price` = giá mới (khoá trùng). */
    emitPriceEdited: (i: PriceEditedEvent): Promise<number> =>
      safely("priceEdited", i, async () => {
        if (i.authorOrg === null) return 0;
        const ref = (i.price.trim() || "-").slice(0, 60).replace(/[^\w.-]+/g, "_");
        const pre = d.savedBy ? await d.savedBy(i.tenantId, i.postId) : null;
        return d.uow.system(i.tenantId, async (r) => {
          const users = pre ?? (await savedUsers(r.tx, i.tenantId, i.postId));
          return deliver(
            r,
            toItems(
              users,
              "priceEdited",
              { id: i.postId, title: i.titleMasked },
              { actor: i.actorName, ref },
            ),
          );
        });
      }),
  };
}
export type CommunityEvents = ReturnType<typeof communityEvents>;
