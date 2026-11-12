// CR-132 M3 · HD-MSG-01..12 · use case tin nhắn Sổ Hợp Tác (lớp 2, không SQL): hội thoại 1-1/nhóm, thành viên, gửi/thu hồi tin, đã đọc, chưa đọc.
// Quyền theo luật thuần (`messages.rules`), RLS (0107) là lưới chặn cuối. Không phải thành viên / không có / tenant khác ⇒ MỘT lỗi `MSG_NOT_FOUND`.
// Người dùng (tên, còn dùng) tra qua cổng `people` (admin.users) NGOÀI tx của gói — không lồng hai kết nối. KHÔNG realtime (M4), tải tệp lên (M5).
import type {
  ConversationDetail,
  ConversationPage,
  CreateConversationRequest,
  Message,
  MessagePage,
  MsgListQuery,
  SendMessageRequest,
  UnreadResponse,
} from "@ai/contracts/pack-contracts";
import type { PackStreamPublishMany, PackUow, PackWho } from "../../../kit/public";
import {
  conversationFrames,
  deletedFrames,
  type MsgFrame,
  newFrames,
  readFrames,
} from "../domain/messages.events";
import { canEditGroup, dmKey, groupSizeOk, messageEmpty } from "../domain/messages.rules";
import { leaveOrRemove, MsgFail, openDirect, openGroup, sendInTx } from "./messages.ops";
import type { MessagesRepo, MessagesRepos, PeopleLookup, RawConversation } from "./messages.ports";
import {
  detailOf,
  encodeCursor,
  messageOf,
  type People,
  personIdsOf,
  summaryOf,
} from "./messages.view";

export { MsgFail };

/** 23505 (trùng khoá: tạo 1-1 / gửi cùng `client_id` đồng thời) và 23503 (FK: hội thoại 1-1 của người kia vừa chèn) ⇒ chạy lại MỘT lần, lần sau thấy bản đã có. */
const RACE_CODES = new Set(["23505", "23503"]);
const pgCodeOf = (e: unknown): string | undefined => {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.code ?? x?.cause?.code;
};
async function retryOnRace<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const c = pgCodeOf(e);
    if (c && RACE_CODES.has(c)) return run();
    throw e;
  }
}

/** Kiểm quyền thao tác NHÓM (đổi tên / thêm người) với khoá hàng hội thoại: 404 → 1-1 cố định (409) → chỉ chủ (403). */
async function lockGroupAsOwner(r: MessagesRepo, me: string, cid: string) {
  const f = await r.facts(me, cid, true);
  if (!f) throw new MsgFail("MSG_NOT_FOUND");
  if (f.kind === "direct") throw new MsgFail("MSG_DIRECT_FIXED");
  if (!canEditGroup(f, f.my_role)) throw new MsgFail("MSG_NOT_OWNER");
  return f;
}

export type MessagesUsecases = ReturnType<typeof messagesUsecases>;

export function messagesUsecases(d: {
  uow: PackUow<MessagesRepos>;
  people: PeopleLookup;
  newId: () => string;
  /** Phát `msg.*` tới `/me/stream` SAU commit (một pipeline Redis cho cả lô khung); vắng (không Redis) ⇒ không phát. Lỗi Redis chỉ log, không ném. */
  publish?: PackStreamPublishMany | undefined;
}) {
  const emit = async (frames: MsgFrame[]): Promise<void> => {
    if (d.publish && frames.length > 0) await d.publish(frames).catch(() => undefined);
  };
  const peopleOf = (who: PackWho, rows: readonly RawConversation[]): Promise<People> =>
    d.people(who, personIdsOf(rows));
  const detail = async (who: PackWho, row: RawConversation | null): Promise<ConversationDetail> => {
    if (!row) throw new MsgFail("MSG_NOT_FOUND");
    return detailOf(row, await peopleOf(who, [row]));
  };
  const active = (p: People, id: string) => p.get(id)?.active === true;

  async function createDirect(who: PackWho, peer: string) {
    const me = who.userId;
    if (peer === me) throw new MsgFail("MSG_DM_SELF");
    const key = dmKey(me, peer);
    // Đã có ⇒ mở lại kể cả khi người kia đã khoá (vẫn đọc được lịch sử); chưa có ⇒ phải là nhân viên còn dùng.
    const old = await d.uow.tenant(who, async (r) => {
      const id = await r.messages.findDm(key);
      return id ? r.messages.conversation(me, id) : null;
    });
    if (old) return { detail: await detail(who, old), created: false };
    if (!active(await d.people(who, [peer]), peer)) throw new MsgFail("MSG_USER_INVALID");
    const made = await retryOnRace(() =>
      d.uow.tenant(who, (r) => openDirect(r.messages, { me, peer, key, newId: d.newId() })),
    );
    const out = await detail(who, made.row);
    if (made.created) await emit(conversationFrames(out.id, { added: [me, peer] }));
    return { detail: out, created: made.created };
  }

  async function createGroup(who: PackWho, title: string, memberIds: string[]) {
    const people = await d.people(who, memberIds);
    if (memberIds.includes(who.userId) || !memberIds.every((id) => active(people, id)))
      throw new MsgFail("MSG_USER_INVALID");
    const row = await d.uow.tenant(who, (r) =>
      openGroup(r.messages, { me: who.userId, title, memberIds, newId: d.newId() }),
    );
    const out = await detail(who, row);
    await emit(conversationFrames(out.id, { added: [who.userId, ...memberIds] }));
    return { detail: out, created: true };
  }

  return {
    async list(
      who: PackWho,
      q: { cursor: { at: string; id: string } | null; limit: number },
    ): Promise<ConversationPage> {
      const rows = await d.uow.tenant(who, (r) =>
        r.messages.conversations(who.userId, q.cursor, q.limit + 1),
      );
      const page = rows.slice(0, q.limit);
      const people = await peopleOf(who, page);
      const last = page[page.length - 1];
      return {
        items: page.map((x) => summaryOf(x, people)),
        next_cursor:
          rows.length > q.limit && last ? encodeCursor({ at: last.last_at, id: last.id }) : null,
      };
    },

    async unread(who: PackWho): Promise<UnreadResponse> {
      return { total: await d.uow.tenant(who, (r) => r.messages.unread(who.userId)) };
    },

    async get(who: PackWho, cid: string): Promise<ConversationDetail> {
      return detail(who, await d.uow.tenant(who, (r) => r.messages.conversation(who.userId, cid)));
    },

    create(
      who: PackWho,
      req: CreateConversationRequest,
    ): Promise<{ detail: ConversationDetail; created: boolean }> {
      return req.kind === "direct"
        ? createDirect(who, req.user_id)
        : createGroup(who, req.title, req.member_ids);
    },

    async rename(who: PackWho, cid: string, title: string): Promise<ConversationDetail> {
      const { row, members } = await d.uow.tenant(who, async (r) => {
        const f = await lockGroupAsOwner(r.messages, who.userId, cid);
        await r.messages.rename(cid, title);
        return { row: await r.messages.conversation(who.userId, cid), members: f.members };
      });
      await emit(conversationFrames(cid, { rest: members.map((m) => m.user_id) }));
      return detail(who, row);
    },

    /** Thêm người: chỉ chủ nhóm; người đã trong nhóm bỏ qua; người mới bắt đầu «đã đọc tới tin cuối» (không đỏ cả lịch sử cũ). */
    async addMembers(who: PackWho, cid: string, userIds: string[]): Promise<ConversationDetail> {
      const people = await d.people(who, userIds);
      const { row, add, have } = await d.uow.tenant(who, async (r) => {
        const f = await lockGroupAsOwner(r.messages, who.userId, cid);
        if (!userIds.every((id) => active(people, id))) throw new MsgFail("MSG_USER_INVALID");
        const have = new Set(f.members.map((m) => m.user_id));
        const add = userIds.filter((id) => !have.has(id));
        if (!groupSizeOk(f.members.length, add.length)) throw new MsgFail("MSG_GROUP_FULL");
        const rows = add.map((u) => ({ user_id: u, role: "member" as const }));
        await r.messages.addMembers(cid, rows, f.last_seq);
        return { row: await r.messages.conversation(who.userId, cid), add, have };
      });
      if (add.length > 0) await emit(conversationFrames(cid, { added: add, rest: [...have] }));
      return detail(who, row);
    },

    async removeMember(who: PackWho, cid: string, targetId: string): Promise<void> {
      const rest = await d.uow.tenant(who, (r) =>
        leaveOrRemove(r.messages, { me: who.userId, cid, targetId }),
      );
      await emit(conversationFrames(cid, { removed: [targetId], rest }));
    },

    async messages(who: PackWho, cid: string, q: MsgListQuery): Promise<MessagePage> {
      const rows = await d.uow.tenant(who, (r) =>
        r.messages.page(who.userId, cid, q.before_seq ?? null, q.limit),
      );
      if (!rows) throw new MsgFail("MSG_NOT_FOUND");
      const items = rows
        .slice(0, q.limit)
        .reverse()
        .map((m) => messageOf(m, cid));
      return { items, has_more: rows.length > q.limit };
    },

    /** Gửi tin. Trùng `client_id` ⇒ bản cũ (`created=false`). 1-1 với người đã khoá ⇒ 409. */
    async send(
      who: PackWho,
      cid: string,
      req: SendMessageRequest,
    ): Promise<{ message: Message; created: boolean; memberIds: string[] }> {
      if (messageEmpty(req.body, req.file_ids.length)) throw new MsgFail("MSG_EMPTY");
      const f = await d.uow.tenant(who, (r) => r.messages.facts(who.userId, cid, false));
      if (!f) throw new MsgFail("MSG_NOT_FOUND");
      const peer =
        f.kind === "direct" ? f.members.find((m) => m.user_id !== who.userId) : undefined;
      if (peer && !active(await d.people(who, [peer.user_id]), peer.user_id))
        throw new MsgFail("MSG_PEER_INACTIVE");
      const row = await retryOnRace(() =>
        d.uow.tenant(who, (r) => sendInTx(r.messages, { me: who.userId, cid, req })),
      );
      const message = messageOf(row, cid);
      if (!row.dup) await emit(newFrames(cid, message, row.member_ids));
      return { message, created: !row.dup, memberIds: row.member_ids };
    },

    /** Thu hồi tin của mình (mọi lúc, lặp lại vô hại). Tin người khác ⇒ 403. */
    async revoke(who: PackWho, cid: string, seq: number): Promise<void> {
      const r = await d.uow.tenant(who, (x) => x.messages.revoke({ me: who.userId, cid, seq }));
      if (!r) throw new MsgFail("MSG_NOT_FOUND");
      if (r.sender_id !== who.userId) throw new MsgFail("MSG_NOT_SENDER");
      if (r.done) await emit(deletedFrames(cid, seq, r.member_ids));
    },

    async markRead(who: PackWho, cid: string, seq: number): Promise<{ unread_total: number }> {
      const out = await d.uow.tenant(who, async (r) => {
        const row = await r.messages.markRead(who.userId, cid, seq);
        if (row === null) throw new MsgFail("MSG_NOT_FOUND");
        return { row, unread_total: await r.messages.unread(who.userId) };
      });
      // Chỉ phát khi mốc đọc TIẾN (mở lại hội thoại đã đọc hết không sinh sự kiện).
      if (out.row.seq > out.row.prev)
        await emit(readFrames(cid, who.userId, out.row.seq, out.row.member_ids));
      return { unread_total: out.unread_total };
    },
  };
}
