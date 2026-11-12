// CR-132 M3 · HD-MSG-01..12 · cổng của use case tin nhắn (lớp 2, chỉ kiểu): repo trong tx `PackUow` (role `contracts_rw`, RLS tenant + thành viên)
// và tra người dùng (admin.users qua kit, NGOÀI tx của gói). Dòng thô từ SQL: use case/`messages.view.ts` đổi sang DTO của contract.
import type { ConvKind, MemberRole } from "@ai/contracts/pack-contracts";

export type RawMember = {
  user_id: string;
  role: MemberRole;
  joined_at: string;
  last_read_seq: number;
};
export type RawLast = {
  seq: number;
  sender_id: string;
  preview: string;
  has_files: boolean;
  deleted: boolean;
  at: string;
};
/** Một dòng hội thoại của người gọi (danh sách / chi tiết). `last_at` là chuỗi ISO µs của PG (làm con trỏ). */
export type RawConversation = {
  id: string;
  kind: ConvKind;
  title: string | null;
  last_at: string;
  member_count: number;
  peer_id: string | null;
  unread: number;
  last: RawLast | null;
  my_role: MemberRole;
  /** Chỉ có ở chi tiết. */
  members: RawMember[] | null;
};
/** Sự thật cần cho kiểm quyền thao tác nhóm (khoá hàng hội thoại khi `lock`). */
export type MsgFacts = {
  kind: ConvKind;
  last_seq: number;
  my_role: MemberRole;
  members: RawMember[];
};
export type RawMessage = {
  seq: number;
  id: string;
  sender_id: string;
  client_id: string;
  body: string;
  at: string;
  deleted: boolean;
  files: { id: string; name: string; mime: string; size: number }[];
};
export type SentRow = RawMessage & { dup: boolean; member_ids: string[] };
export type RevokeRow = { sender_id: string; was_deleted: boolean; done: boolean };

export type MessagesRepo = {
  conversations(
    me: string,
    cursor: { at: string; id: string } | null,
    limit: number,
  ): Promise<RawConversation[]>;
  conversation(me: string, cid: string): Promise<RawConversation | null>;
  /** Tổng chưa đọc (đã kẹp 999) của người gọi — MỘT câu. */
  unread(me: string): Promise<number>;
  facts(me: string, cid: string, lock: boolean): Promise<MsgFacts | null>;
  findDm(key: string): Promise<string | null>;
  /** Chèn hội thoại KHÔNG RETURNING (người tạo chưa là thành viên nên SELECT policy chặn); 1-1 trùng khoá ⇒ 23505 (use case chạy lại một lần; `ON CONFLICT` cần cả policy SELECT nên không dùng). */
  createConversation(c: {
    id: string;
    kind: ConvKind;
    title: string | null;
    dmKey: string | null;
    createdBy: string;
  }): Promise<void>;
  /** Một câu chèn nhiều thành viên; `readFrom` = mốc đọc ban đầu (= `last_seq` lúc vào ⇒ không «chưa đọc» cả lịch sử cũ). */
  addMembers(
    cid: string,
    rows: { user_id: string; role: MemberRole }[],
    readFrom: number,
  ): Promise<void>;
  rename(cid: string, title: string): Promise<void>;
  setOwner(cid: string, userId: string): Promise<void>;
  removeMember(cid: string, userId: string): Promise<void>;
  /** Người cuối rời ⇒ xoá hội thoại + đánh dấu xoá tệp (hàm definer `msg_drop_if_empty`). */
  dropIfEmpty(cid: string): Promise<boolean>;
  /** null = không phải thành viên (⇒ 404). Trả tối đa `limit + 1` tin, mới → cũ. */
  page(
    me: string,
    cid: string,
    beforeSeq: number | null,
    limit: number,
  ): Promise<RawMessage[] | null>;
  /** null = không phải thành viên. Trùng `client_id` ⇒ `dup` + bản cũ. */
  send(m: { me: string; cid: string; clientId: string; body: string }): Promise<SentRow | null>;
  /** Gắn tệp (đã tải lên bởi chính người gửi, chưa gửi) vào tin `seq`; trả tệp gắn được (thiếu ⇒ use case báo `MSG_FILE_INVALID`). */
  attach(m: {
    me: string;
    cid: string;
    seq: number;
    fileIds: string[];
  }): Promise<RawMessage["files"]>;
  filesOf(cid: string, seq: number): Promise<RawMessage["files"]>;
  revoke(m: { me: string; cid: string; seq: number }): Promise<RevokeRow | null>;
  /** null = không phải thành viên. Trả mốc đọc mới (đã kẹp theo `clampRead`: không lùi, không vượt tin cuối). */
  markRead(me: string, cid: string, seq: number): Promise<number | null>;
};
export type MessagesRepos = { messages: MessagesRepo };

export type PeopleLookup = (
  who: { tenantId: string; userId: string },
  ids: readonly string[],
) => Promise<Map<string, { name: string; active: boolean }>>;
