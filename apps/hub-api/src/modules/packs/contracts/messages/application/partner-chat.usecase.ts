// CR-169 · lát 3b · use case cuộc `partner` (lớp 2, không SQL): chi tiết, trang tin, gửi, thu hồi, đã đọc, tải lên / lấy tệp, dọn tệp chưa gắn. Quyền ở hàm DEFINER
// `pmsg_*` (không là đầu cuộc / công ty thứ ba ⇒ CC404 ⇒ 404 cùng thân; route ánh xạ ở `partner.errors.ts`). Phát `msg.*` SAU commit, CHỈ cho hai đầu (một pipeline Redis,
// không chuông). Byte tệp ở FileBox: lên NGOÀI tx, DB từ chối ⇒ xoá byte vừa lên; thu hồi ⇒ gỡ byte SAU commit. Số câu mỗi thao tác cố định (1–3).
import { ATTACH_MAX_BYTES } from "@ai/contracts/attach";
import type {
  ConversationDetail,
  FileRef,
  Message,
  MessagePage,
  MsgListQuery,
  SendMessageRequest,
} from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../../kit/public";
import { orgForTenant } from "../../../kit/public";
import { mimeByName } from "../../domain/contract-files.rules";
import { deletedFrames, type MsgFrame, newFrames, readFrames } from "../domain/messages.events";
import { messageEmpty } from "../domain/messages.rules";
import { fileKeyOf, fileKeyParts } from "../domain/partner.files";
import { partnerSendError } from "../domain/partner.rules";
import { beforeOf, hasNewer } from "./messages.find";
import { MsgFail } from "./messages.ops";
import type { MessagesRepos, MsgFileStore, PeopleLookup } from "./messages.ports";
import { messageOf, partnerDetailOf } from "./messages.view";
import type { MessagesFileOps } from "./messages-files.usecase";

export type PartnerChatDeps = {
  uow: PackUow<MessagesRepos>;
  people: PeopleLookup;
  emit: (frames: MsgFrame[]) => Promise<void>;
  files?: MsgFileStore | undefined;
  fileOps: MessagesFileOps;
  newId: () => string;
};
const NO_STORE = "filebox not configured";

export function partnerChatOps(d: PartnerChatDeps) {
  const bothEnds = (who: PackWho, peer: string | null) =>
    peer ? [who.userId, peer] : [who.userId];
  return {
    /** `GET /messages/partner/:id` — chi tiết (members 2). Không là đầu cuộc ⇒ DB CC404. */
    async partnerGet(who: PackWho, id: string): Promise<ConversationDetail> {
      const row = await d.uow.tenant(who, (r) => r.partner.detail(id));
      if (!row) throw new MsgFail("MSG_NOT_FOUND");
      const self = (await d.people(who, [who.userId])).get(who.userId);
      return partnerDetailOf(row, { id: who.userId, name: self?.name ?? "" });
    },

    /** Trang tin: `pmsg_page` (seq giảm dần, `has_more` tính trong hàm) ⇒ đảo sang cũ → mới như cuộc nội bộ. */
    async partnerMessages(who: PackWho, id: string, q: MsgListQuery): Promise<MessagePage> {
      const got = await d.uow.tenant(who, async (r) => {
        const page = await r.partner.page(id, beforeOf(q), q.limit);
        // `around_seq`: tin cuối của cuộc (từ chi tiết) để biết còn tin mới hơn không.
        const last = q.around_seq ? ((await r.partner.detail(id))?.last?.seq ?? 0) : 0;
        return { page, last };
      });
      const items = got.page.items.map((m) => messageOf(m, id)).reverse();
      return {
        items,
        has_more: got.page.has_more,
        ...(q.around_seq ? { has_newer: hasNewer(items, got.last) } : {}),
      };
    },

    /** Gửi (P4): idempotent theo `client_id`; gửi lặp không phát. Hết kết nối ⇒ 409 `MSG_NOT_CONNECTED`, người kia hết hợp lệ ⇒ 409 `MSG_PEER_INACTIVE` (DB). */
    async partnerSend(
      who: PackWho,
      id: string,
      req: SendMessageRequest,
    ): Promise<{ message: Message; created: boolean }> {
      if (messageEmpty(req.body, req.file_ids.length)) throw new MsgFail("MSG_EMPTY");
      const out = await d.uow.tenant(who, (r) =>
        r.partner.send({ id, clientId: req.client_id, body: req.body, fileIds: req.file_ids }),
      );
      const message = messageOf(out.message, id);
      if (out.created)
        await d.emit(
          newFrames(
            id,
            message,
            out.notify.map((n) => n.user_id),
          ),
        );
      return { message, created: out.created };
    },

    /** Thu hồi tin của mình (mọi lúc). Gỡ byte FileBox SAU commit (tệp của người gửi ⇒ org công ty người gọi). */
    async partnerRevoke(who: PackWho, id: string, seq: number): Promise<void> {
      const out = await d.uow.tenant(who, async (r) => {
        const row = await r.partner.detail(id); // đầu cuộc (404) + người kia để phát
        const boxIds = await r.partner.remove(id, seq);
        return { peer: row?.peer_id ?? null, boxIds };
      });
      const org = orgForTenant(who.tenantId);
      await d.fileOps.dropBytes(out.boxIds.map((fileId) => ({ org, file_id: fileId })));
      await d.emit(deletedFrames(id, seq, bothEnds(who, out.peer)));
    },

    /** Đã đọc (P6): chỉ phát khi mốc TIẾN. `unread_total` = nội bộ + partner. */
    async partnerMarkRead(
      who: PackWho,
      id: string,
      seq: number,
    ): Promise<{ unread_total: number }> {
      const out = await d.uow.tenant(who, async (r) => {
        const row = await r.partner.detail(id);
        const mark = await r.partner.markRead(id, seq);
        return {
          prev: row?.partner?.my_read_seq ?? 0,
          mark,
          peer: row?.peer_id ?? null,
          unread_total: await r.messages.unread(who.userId),
        };
      });
      if (out.mark > out.prev)
        await d.emit(readFrames(id, who.userId, out.mark, bothEnds(who, out.peer)));
      return { unread_total: out.unread_total };
    },

    /** Tải lên: đầu cuộc (404) → đuôi (415) → dung lượng (413) → còn gửi được (409) → byte lên FileBox → ghi DB một câu (DB từ chối ⇒ xoá byte). */
    async partnerUpload(
      who: PackWho,
      id: string,
      f: { name: string; bytes: Uint8Array },
    ): Promise<FileRef> {
      const store = d.files;
      if (!store) throw new Error(NO_STORE);
      const block = await d.uow.tenant(who, async (r) => {
        const p = (await r.partner.detail(id))?.partner;
        if (!p) return "none" as const;
        // chỉ khi `read_only` mới cần biết «hết kết nối» hay «người kia hết hợp lệ» (mã 409 khác nhau, thứ tự theo `partnerSendError`)
        const connected = p.read_only ? await r.partner.connected(p.company_id) : true;
        return partnerSendError(connected, p.peer_active);
      });
      if (block === "none") throw new MsgFail("MSG_NOT_FOUND");
      const mime = mimeByName(f.name);
      if (!mime || f.bytes.byteLength === 0) throw new MsgFail("MSG_FILE_TYPE");
      if (f.bytes.byteLength > ATTACH_MAX_BYTES) throw new MsgFail("MSG_FILE_TOO_LARGE");
      if (block) throw new MsgFail(block); // chặn sớm: khỏi đẩy ≤ 20 MB lên FileBox vô ích (DB vẫn kiểm lại ở `pmsg_file_add`)
      const org = orgForTenant(who.tenantId);
      const put = await store.put(org, f.name, f.bytes);
      const fileId = d.newId();
      return d.uow
        .tenant(who, (r) =>
          r.partner.fileAdd(id, {
            fileId,
            boxId: put.fileId,
            name: f.name,
            mime,
            size: f.bytes.byteLength,
            key: fileKeyOf(who.tenantId, fileId),
          }),
        )
        .then((x) => ({ id: x.id, name: x.name, mime: x.mime as FileRef["mime"], size: x.size }))
        .catch(async (e) => {
          await store.remove(org, put.fileId).catch(() => undefined);
          throw e;
        });
    },

    /** Link tải ngắn hạn (FileBox, org của BÊN TẢI suy từ khoá). Không thấy (ngoài cuộc, chưa gắn của người khác, đã thu hồi) ⇒ 404. */
    async partnerFileLink(who: PackWho, id: string, fileId: string): Promise<string> {
      const store = d.files;
      if (!store) throw new Error(NO_STORE);
      const ref = await d.uow.tenant(who, (r) => r.partner.fileGet(id, fileId));
      const p = ref ? fileKeyParts(ref.key) : null;
      const url = ref && p ? await store.link(orgForTenant(p.tenant), ref.boxId) : null;
      if (!url) throw new MsgFail("MSG_NOT_FOUND");
      return url;
    },
  };
}

const SWEEP_PARALLEL = 20;
/** Việc nền: DB soft-delete tệp chưa gắn tin > 24 h (một câu, scope system) rồi xoá byte FileBox (song song có trần; lỗi nuốt — hàng DB đã đánh dấu). */
export function partnerFileSweep(d: {
  claim: () => Promise<{ id: string; key: string; boxId: string }[]>;
  store: MsgFileStore;
}) {
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
