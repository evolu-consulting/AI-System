// CR-161 · lát 6 · use case trò chuyện hai công ty (spec §2 R8, R11; §3). Một use case = một tx theo scope tenant (`PackUow`), số câu SQL cố định.
// Quyền người dùng (R1: chỉ Toàn quyền) do `packGuard` ở route VÀ do DB (`hub.cc_ctx`, 42501). `cc.msg` (`/me/stream`) phát SAU commit tới người
// Toàn quyền CẢ HAI công ty (một pipeline Redis); lỗi Redis chỉ nuốt. Tệp: byte lên FileBox NGOÀI tx, ghi DB sau — DB không nhận ⇒ xoá byte vừa lên.
import type { CcFile } from "@ai/contracts/pack-contracts";
import type { PackStreamFrame, PackStreamPublishMany, PackUow, PackWho } from "../../../kit/public";
import { orgForTenant } from "../../../kit/public";
import { ChatFail } from "../domain/chat.errors";
import { fileKeyOf, fileKeyParts } from "../domain/chat.files";
import type { ChatFileStore, ChatPage, ChatRepo, ChatSweepClaim } from "./chat.ports";
import type { CcOwner } from "./connect.ports";

export type ChatRepos = { chat: ChatRepo };
export type ChatDeps = {
  uow: PackUow<ChatRepos>;
  /** Tên hiển thị của người gửi (lưu cùng tin). */
  selfName: (who: PackWho) => Promise<string>;
  /** Vắng (không Redis) ⇒ không phát. */
  publish?: PackStreamPublishMany | undefined;
  /** Vắng (không FileBox) ⇒ route tệp 503, tin chữ vẫn chạy. */
  files?: ChatFileStore | undefined;
};
export type ChatMessagesOut = {
  items: ChatPage["items"];
  next_before: number | null;
  read_only: boolean;
  last_read_seq: number;
};

/** `cc.msg` cho mỗi công ty: `tenant_id` của khung = công ty KIA (so với người nhận). Tab khác của người gửi cũng nhận. */
export function msgFrames(
  notify: readonly CcOwner[],
  mine: string,
  other: string,
  seq: number,
): PackStreamFrame[] {
  const side = (self: string, peer: string): PackStreamFrame[] => {
    const userIds = [...new Set(notify.filter((o) => o.tenant_id === self).map((o) => o.user_id))];
    return userIds.length === 0
      ? []
      : [{ userIds, event: "cc.msg", data: { tenant_id: peer, seq } }];
  };
  return [...side(mine, other), ...side(other, mine)];
}

export function chatUsecases(d: ChatDeps) {
  return {
    /** Kho nội dung có cấu hình không (vắng ⇒ route tệp trả 503). */
    filesEnabled: d.files !== undefined,

    /** Trang tin mới → cũ (xin `limit + 1` để biết còn trang; `next_before` = seq nhỏ nhất của trang). */
    async page(
      who: PackWho,
      other: string,
      q: { before: number | null; limit: number },
    ): Promise<ChatMessagesOut> {
      const p = await d.uow.tenant(who, (r) => r.chat.page(other, q.before, q.limit + 1));
      const items = p.items.slice(0, q.limit);
      const last = items.at(-1);
      return {
        items,
        next_before: p.items.length > q.limit && last ? last.seq : null,
        read_only: p.read_only,
        last_read_seq: p.last_read_seq,
      };
    },

    /** R8 · gửi tin. `created=false` (gửi lặp cùng `client_id`) ⇒ không phát lại. */
    async send(
      who: PackWho,
      other: string,
      b: { client_id: string; body: string; file_ids: readonly string[] },
    ) {
      const name = await d.selfName(who);
      const out = await d.uow.tenant(who, (r) =>
        r.chat.send(other, b.client_id, name, b.body, b.file_ids),
      );
      if (out.created && d.publish && out.notify.length > 0)
        await d.publish(msgFrames(out.notify, who.tenantId, other, out.seq)).catch(() => undefined);
      return { message: out.message, created: out.created };
    },

    markRead: (who: PackWho, other: string, seq: number): Promise<number> =>
      d.uow.tenant(who, (r) => r.chat.markRead(other, seq)),

    /** R11 · tải lên: đang kết nối (409) → byte lên FileBox → ghi DB. Đuôi/dung lượng do route kiểm (415/413). */
    async uploadFile(
      who: PackWho,
      other: string,
      f: { name: string; mime: string; bytes: Uint8Array },
    ): Promise<CcFile> {
      const store = d.files;
      if (!store) throw new Error("filebox not configured");
      if (!(await d.uow.tenant(who, (r) => r.chat.connected(other))))
        throw new ChatFail("CONNECT_READ_ONLY");
      const org = orgForTenant(who.tenantId);
      const { fileId: boxId } = await store.put(org, f.name, f.bytes);
      try {
        const id = crypto.randomUUID();
        return await d.uow.tenant(who, (r) =>
          r.chat.fileAdd(other, {
            id,
            boxId,
            name: f.name,
            mime: f.mime,
            size: f.bytes.byteLength,
            key: fileKeyOf(who.tenantId, id),
          }),
        );
      } catch (e) {
        await store.remove(org, boxId).catch(() => undefined);
        throw e;
      }
    },

    /** R11 · link tải ngắn hạn (5 phút do FileBox); không thấy (ngoài cặp, đã xoá, chưa gắn của người khác) ⇒ null (route 404). */
    async fileLink(who: PackWho, fileId: string): Promise<string | null> {
      const store = d.files;
      if (!store) throw new Error("filebox not configured");
      const ref = await d.uow.tenant(who, (r) => r.chat.fileRef(fileId));
      const p = ref ? fileKeyParts(ref.key) : null;
      return ref && p ? store.link(orgForTenant(p.tenant), ref.boxId) : null;
    },
  };
}
export type ChatUsecases = ReturnType<typeof chatUsecases>;

const SWEEP_PARALLEL = 20;
/** R11 · việc nền: DB soft-delete tệp chưa gắn > 24 h (một câu, scope system) rồi xoá nội dung FileBox (song song có trần; lỗi nuốt — hàng DB đã đánh dấu). */
export function chatFileSweep(d: { claim: ChatSweepClaim; store: ChatFileStore }) {
  return async (): Promise<number> => {
    const rows = await d.claim();
    for (let i = 0; i < rows.length; i += SWEEP_PARALLEL)
      await Promise.allSettled(
        rows.slice(i, i + SWEEP_PARALLEL).map((r) => {
          const p = fileKeyParts(r.key);
          return p ? d.store.remove(orgForTenant(p.tenant), r.boxId) : Promise.resolve();
        }),
      );
    return rows.length;
  };
}
