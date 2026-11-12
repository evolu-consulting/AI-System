// CR-132 M3 · HD-MSG-01..12 · các bước NGUYÊN TỬ chạy trong MỘT tx của use case tin nhắn (tách riêng cho gọn + dễ đọc). Không SQL (gọi repo), không I/O ngoài tx.
import type { MemberRole, MsgErrorCode, SendMessageRequest } from "@ai/contracts/pack-contracts";
import { canRemoveMember, nextOwner } from "../domain/messages.rules";
import type { MessagesRepo, RawConversation, SentRow } from "./messages.ports";

/** Lỗi nghiệp vụ ⇒ route đổi sang HTTP theo `MSG_ERRORS` (không câu chữ ở server — client dịch theo mã). */
export class MsgFail extends Error {
  constructor(readonly code: MsgErrorCode) {
    super(code);
  }
}

const member = (user_id: string, role: MemberRole) => ({ user_id, role });

/** 1-1: đã có ⇒ trả bản cũ; chưa có ⇒ hội thoại + lô thành viên đầu (cả hai) CÙNG tx, id sinh phía app, không RETURNING khi chèn hội thoại. */
export async function openDirect(
  r: MessagesRepo,
  a: { me: string; peer: string; key: string; newId: string },
): Promise<{ row: RawConversation | null; created: boolean }> {
  const found = await r.findDm(a.key);
  if (found) return { row: await r.conversation(a.me, found), created: false };
  await r.createConversation({
    id: a.newId,
    kind: "direct",
    title: null,
    dmKey: a.key,
    createdBy: a.me,
  });
  await r.addMembers(a.newId, [member(a.me, "member"), member(a.peer, "member")], 0);
  return { row: await r.conversation(a.me, a.newId), created: true };
}

/** Nhóm: người tạo là chủ (vai `owner`), còn lại là thành viên; CÙNG tx như 1-1. */
export async function openGroup(
  r: MessagesRepo,
  a: { me: string; title: string; memberIds: string[]; newId: string },
): Promise<RawConversation | null> {
  await r.createConversation({
    id: a.newId,
    kind: "group",
    title: a.title,
    dmKey: null,
    createdBy: a.me,
  });
  const rows = [member(a.me, "owner"), ...a.memberIds.map((u) => member(u, "member"))];
  await r.addMembers(a.newId, rows, 0);
  return r.conversation(a.me, a.newId);
}

/**
 * Bớt người / rời nhóm. Chủ rời ⇒ người vào sớm nhất thành chủ (UPDATE vai TRƯỚC, rồi mới xoá hàng mình — RLS `msg_members`);
 * người cuối rời ⇒ xoá hội thoại + đánh dấu xoá tệp.
 */
export async function leaveOrRemove(
  r: MessagesRepo,
  a: { me: string; cid: string; targetId: string },
): Promise<void> {
  const f = await r.facts(a.me, a.cid, true);
  if (!f) throw new MsgFail("MSG_NOT_FOUND");
  if (f.kind === "direct") throw new MsgFail("MSG_DIRECT_FIXED");
  if (!canRemoveMember(f, { id: a.me, role: f.my_role }, a.targetId))
    throw new MsgFail("MSG_NOT_OWNER");
  const target = f.members.find((m) => m.user_id === a.targetId);
  if (!target) throw new MsgFail("MSG_NOT_FOUND");
  const rest = f.members.filter((m) => m.user_id !== a.targetId);
  const next = target.role === "owner" ? nextOwner(rest) : null;
  if (next) await r.setOwner(a.cid, next);
  await r.removeMember(a.cid, a.targetId);
  if (rest.length === 0) await r.dropIfEmpty(a.cid);
}

/** Chèn tin + gắn tệp. Trùng `client_id` ⇒ bản cũ (kèm tệp đã gắn). Tệp không hợp lệ ⇒ `MSG_FILE_INVALID` (tx hoàn tác cả tin). */
export async function sendInTx(
  r: MessagesRepo,
  a: { me: string; cid: string; req: SendMessageRequest },
): Promise<SentRow> {
  const row = await r.send({ me: a.me, cid: a.cid, clientId: a.req.client_id, body: a.req.body });
  if (!row) throw new MsgFail("MSG_NOT_FOUND");
  if (row.dup) return { ...row, files: await r.filesOf(a.cid, row.seq) };
  if (a.req.file_ids.length === 0) return row;
  const files = await r.attach({ me: a.me, cid: a.cid, seq: row.seq, fileIds: a.req.file_ids });
  if (files.length !== a.req.file_ids.length) throw new MsgFail("MSG_FILE_INVALID");
  return { ...row, files };
}
