// CR-102 · com-c9 · `communityEvents.emit*`: phát chuông Community TRONG tx của hành động (cùng commit/rollback). Mỗi lần phát =
// số câu cố định: (ứng viên) + tuỳ chọn + MỘT `notify.enqueue` cho cả lô — không vòng lặp từng người nhận.
// C6 (bình luận) gọi `emitComment` từ route/service của mình sau khi chèn bình luận.
import type { Tx } from "@ai/db";
import type { Notifier } from "../../kit/application/notify";
import {
  type BellKind,
  bellKind,
  bellText,
  type Cand,
  commentRecipients,
  newPostKind,
} from "../domain/notify.rules";
import { commentCandidates, wantedOnly } from "./notify.repo";

/** Phần repo trong tx mà `PackUow` đưa cho gói (`notify` do bộ khung ghép sẵn). */
export type EventTx = { tx: Tx; notify: Notifier };
export type Actor = { userId: string; name: string };

export type CommunityEventDeps = {
  /** Chủ quản (user nội bộ có quyền đọc gói) của tenant — một câu. */
  hosts: (tenantId: string) => Promise<readonly string[]>;
  /** Chủ quản đã LƯU BÁO GIÁ từ bài (C7); vắng ⇒ `priceEdited` không phát. */
  savedBy?: (tenantId: string, postId: string) => Promise<readonly string[]>;
  /** Chủ quản có sản phẩm khớp bài Cần mua (qua `HostBookReader`); vắng ⇒ `matchBuy` không phát. */
  stockMatch?: (tenantId: string, product: string) => Promise<readonly string[]>;
  now?: () => Date;
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

export function communityEvents(d: CommunityEventDeps) {
  return {
    /** Bình luận mới (đã chèn): người đăng ⇒ comment; người từng bình luận trong luồng ⇒ reply; tôn trọng visibility. */
    async emitComment(
      r: EventTx,
      i: {
        tenantId: string;
        postId: string;
        threadOrg: string;
        commentId: string;
        actor: Actor;
        /** Công ty đối tác đã rời (từ danh bạ) — không nhận. */
        inactiveOrgs?: readonly string[];
      },
    ): Promise<number> {
      const { title, cands } = await commentCandidates(r.tx, {
        tenantId: i.tenantId,
        postId: i.postId,
        threadOrg: i.threadOrg,
        actorUserId: i.actor.userId,
        at: d.now?.() ?? new Date(),
        inactiveOrgs: i.inactiveOrgs ?? [],
      });
      const post = { id: i.postId, title };
      const o = { actor: i.actor.name, threadOrg: i.threadOrg, ref: i.commentId };
      return deliver(
        r,
        commentRecipients(cands, i.threadOrg, i.actor.userId).map((c) => ({ c, post, o })),
      );
    },

    /** Bài mới của đối tác ⇒ chủ quản (newSell/newBuy) + (Cần mua khớp hàng đang có) matchBuy. Tiêu đề = bản đã che. */
    async emitNewPost(
      r: EventTx,
      i: {
        tenantId: string;
        postId: string;
        type: string;
        authorOrg: string | null;
        authorUserId: string;
        actorName: string;
        titleMasked: string;
        product?: string;
      },
    ): Promise<number> {
      const kind = newPostKind({ type: i.type, authorOrg: i.authorOrg });
      if (!kind) return 0;
      const post = { id: i.postId, title: i.titleMasked };
      const o = { actor: i.actorName, ref: i.postId };
      const hosts = await d.hosts(i.tenantId);
      const items = toItems(hosts, kind, post, o);
      if (kind === "newBuy" && d.stockMatch && i.product) {
        const have = await d.stockMatch(i.tenantId, i.product);
        // chủ quản khớp hàng nhận matchBuy THAY cho newBuy (một bài ⇒ một thông báo mỗi người)
        const m = new Set(have);
        return deliver(r, [
          ...items.filter((x) => !m.has(x.c.userId)),
          ...toItems(
            hosts.filter((h) => m.has(h)),
            "matchBuy",
            post,
            o,
          ),
        ]);
      }
      return deliver(r, items);
    },

    /** NCC sửa giá bài đã lưu báo giá ⇒ CHỈ chủ quản đã lưu (R29: không gửi gì cho NCC). `price` = giá mới (khoá trùng). */
    async emitPriceEdited(
      r: EventTx,
      i: {
        tenantId: string;
        postId: string;
        authorOrg: string | null;
        actorName: string;
        titleMasked: string;
        price: string;
      },
    ): Promise<number> {
      if (i.authorOrg === null || !d.savedBy) return 0;
      const users = await d.savedBy(i.tenantId, i.postId);
      const ref = (i.price.trim() || "-").slice(0, 60).replace(/[^\w.-]+/g, "_");
      return deliver(
        r,
        toItems(
          users,
          "priceEdited",
          { id: i.postId, title: i.titleMasked },
          { actor: i.actorName, ref },
        ),
      );
    },
  };
}
export type CommunityEvents = ReturnType<typeof communityEvents>;
