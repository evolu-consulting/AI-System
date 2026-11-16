// CR-178 · use case «Ảnh & tệp» (M4) và tìm tin (M3) — lớp 2, không SQL. Quyền: nội bộ = thành viên (kiểm `facts`, RLS là lưới cuối); `partner` = hàm DEFINER `pmsg_*`
// (người ngoài cuộc / công ty thứ ba ⇒ CC404 ⇒ 404 `MSG_NOT_FOUND`, không lộ). Số câu mỗi thao tác cố định (không theo số dòng).
import type {
  MsgAttachmentPage,
  MsgAttachmentsQuery,
  MsgSearchHit,
  MsgSearchPage,
} from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../../kit/public";
import { attachmentOf, encodeAttachCursor, kindOrNull } from "./messages.find";
import { internalOnPartnerDenied, MsgFail } from "./messages.ops";
import type { MessagesRepos, PeopleLookup, RawAttachment, RawSearchHit } from "./messages.ports";
import {
  encodeSearchCursor,
  escapeLike,
  newerFirst,
  type SearchCursor,
  snippetOf,
} from "./messages.search";

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

/** Dựng kết quả: tiêu đề = tên nhóm / tên người kia (1-1, `partner`); cuộc `partner` đã có sẵn tên người gửi + công ty từ DB. */
function hitOf(
  r: RawSearchHit,
  q: string,
  names: ReadonlyMap<string, { name: string }>,
): MsgSearchHit {
  const { snippet, match } = snippetOf(r.body, q);
  const partner = r.kind === "partner";
  return {
    conversation_id: r.conversation_id,
    kind: r.kind,
    title: partner
      ? (r.peer_name ?? "")
      : r.kind === "direct"
        ? (names.get(r.peer_id ?? "")?.name ?? "")
        : (r.title ?? ""),
    company: partner && r.company_id ? { id: r.company_id, name: r.company_name ?? "" } : null,
    seq: Number(r.seq),
    sender_id: r.sender_id,
    sender_name: r.sender_name ?? names.get(r.sender_id)?.name ?? "",
    at: new Date(r.at).toISOString(),
    snippet,
    match,
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

    /**
     * `GET /messages/search` — tin khớp (không phân biệt hoa/dấu) ở cuộc nội bộ người gọi là thành viên (RLS) HỢP với cuộc `partner` người gọi là một đầu (DB), mới nhất trước.
     * Mỗi nguồn LIMIT n+1 theo cùng keyset rồi trộn + cắt n ⇒ đúng thứ tự, số câu cố định (2). Người không có quyền Sổ Hợp Tác ⇒ chỉ phần nội bộ (như danh sách).
     */
    async search(
      who: PackWho,
      q: { q: string; conversationId: string | null; cur: SearchCursor | null; limit: number },
    ): Promise<MsgSearchPage> {
      const sq = {
        pattern: escapeLike(q.q),
        conversationId: q.conversationId,
        cur: q.cur,
        limit: q.limit + 1,
      };
      const load = (withPartner: boolean) =>
        d.uow.tenant(who, async (r) => {
          const internal = await r.messages.search(who.userId, sq);
          return withPartner ? [...internal, ...(await r.partner.search(sq))] : internal;
        });
      const rows = (
        await internalOnPartnerDenied(
          () => load(true),
          () => load(false),
        )
      ).sort(newerFirst);
      const page = rows.slice(0, q.limit);
      const ids = page.flatMap((r) => (r.kind === "partner" ? [] : [r.sender_id, r.peer_id ?? ""]));
      const names =
        ids.length > 0 ? await d.people(who, [...new Set(ids.filter(Boolean))]) : new Map();
      const last = page[page.length - 1];
      return {
        items: page.map((r) => hitOf(r, q.q, names)),
        next_cursor:
          rows.length > q.limit && last
            ? encodeSearchCursor({ at: last.at, cid: last.conversation_id, seq: Number(last.seq) })
            : null,
      };
    },
  };
}
