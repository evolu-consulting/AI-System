// CR-178 · use case «Ảnh & tệp» (M4) và tìm tin (M3) — lớp 2, không SQL. Quyền: nội bộ = thành viên (kiểm `facts`, RLS là lưới cuối); `partner` = hàm DEFINER `pmsg_*`
// (người ngoài cuộc / công ty thứ ba ⇒ CC404 ⇒ 404 `MSG_NOT_FOUND`, không lộ). Số câu mỗi thao tác cố định (không theo số dòng).
import type { MsgAttachmentPage, MsgAttachmentsQuery } from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../../kit/public";
import { attachmentOf, encodeAttachCursor, kindOrNull } from "./messages.find";
import { MsgFail } from "./messages.ops";
import type { MessagesRepos, PeopleLookup, RawAttachment } from "./messages.ports";

type FindDeps = { uow: PackUow<MessagesRepos>; people: PeopleLookup };
type Cur = { seq: number; id: string } | null;

/** Cắt dòng thừa, dựng DTO + con trỏ (dòng cuối của trang). `nameOf` tra tên người gửi (cuộc `partner` đã có sẵn trong dòng). */
function pageOf(
  rows: readonly RawAttachment[],
  limit: number,
  nameOf: (r: RawAttachment) => string,
): MsgAttachmentPage {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => attachmentOf(r, nameOf(r))),
    next_cursor:
      rows.length > limit && last
        ? encodeAttachCursor({ seq: Number(last.seq), id: last.id })
        : null,
  };
}

export function messagesFindOps(d: FindDeps) {
  return {
    /** `GET /messages/conversations/:id/attachments` — không phải thành viên / không có ⇒ 404. */
    async attachments(
      who: PackWho,
      cid: string,
      q: Pick<MsgAttachmentsQuery, "kind" | "limit"> & { cur: Cur },
    ): Promise<MsgAttachmentPage> {
      const rows = await d.uow.tenant(who, async (r) => {
        if (!(await r.messages.facts(who.userId, cid, false))) return null;
        return r.messages.attachments(cid, {
          kind: kindOrNull(q.kind),
          cur: q.cur,
          limit: q.limit + 1,
        });
      });
      if (!rows) throw new MsgFail("MSG_NOT_FOUND");
      const names = await d.people(who, [
        ...new Set(rows.slice(0, q.limit).map((r) => r.sender_id)),
      ]);
      return pageOf(rows, q.limit, (r) => names.get(r.sender_id)?.name ?? "");
    },

    /** `GET /messages/partner/:id/attachments` — kể cả sau ngắt kết nối (P3). Không là đầu cuộc ⇒ DB CC404. */
    async partnerAttachments(
      who: PackWho,
      id: string,
      q: Pick<MsgAttachmentsQuery, "kind" | "limit"> & { cur: Cur },
    ): Promise<MsgAttachmentPage> {
      const rows = await d.uow.tenant(who, (r) =>
        r.partner.attachments(id, { kind: kindOrNull(q.kind), cur: q.cur, limit: q.limit + 1 }),
      );
      return pageOf(rows, q.limit, (r) => r.sender_name ?? "");
    },
  };
}
