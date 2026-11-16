// CR-132 M3 · HD-MSG-01..12 · cổng của use case tin nhắn (lớp 2, chỉ kiểu): repo trong tx `PackUow` (role `contracts_rw`, RLS tenant + thành viên)
// và tra người dùng (admin.users qua kit, NGOÀI tx của gói). Dòng thô từ SQL: use case/`messages.view.ts` (cùng thư mục) đổi sang DTO của contract.
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
  /** Chỉ cuộc `partner` (tên người gửi tra sẵn trong DB; `direct`/`group` tra qua cổng `people`). */
  sender_name?: string;
};
/** CR-169 · phần riêng của cuộc `partner` (người + công ty đầu kia, tính sẵn trong hàm `pmsg_*`). `my_read_seq`/`peer_read_seq` chỉ ở chi tiết. */
export type RawPartner = {
  peer_name: string;
  peer_title: string | null;
  peer_active: boolean;
  company_id: string;
  company_name: string;
  read_only: boolean;
  my_read_seq?: number;
  peer_read_seq?: number;
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
  /** CR-169 · chỉ `kind = 'partner'`. */
  partner: RawPartner | null;
};
/** CR-169 · nguồn của danh sách hợp nhất (P9): nội bộ (`msg_*`) và/hoặc `partner` (`pmsg_*`); `company` = công ty lọc (chỉ nguồn partner). */
export type ListQuery = {
  cursor: { at: string; id: string } | null;
  limit: number;
  source: { internal: boolean; partner: boolean };
  company: string | null;
  /** CR-178 · chỉ cuộc có tin chưa đọc (cùng luật đếm với `unread`). */
  unreadOnly: boolean;
};
/** CR-178 M4 · một tệp đã gửi của cuộc (đã gắn tin chưa thu hồi); `sender_name` chỉ có ở cuộc `partner` (DB tra sẵn). */
export type RawAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  seq: number;
  sender_id: string;
  at: string;
  sender_name?: string;
};
/** Keyset `(seq, id)` DESC; `kind` null = cả hai; `limit` đã +1 (route xin thừa một dòng để biết còn trang sau). */
export type AttachQuery = {
  kind: "image" | "file" | null;
  cur: { seq: number; id: string } | null;
  limit: number;
};
/** CR-178 M3 · một tin khớp. Cuộc `partner`: tên người gửi / người kia / công ty tra sẵn trong DB; nội bộ: `peer_id` (1-1) tra tên qua cổng `people`. */
export type RawSearchHit = {
  conversation_id: string;
  kind: ConvKind;
  title: string | null;
  seq: number;
  sender_id: string;
  /** ISO µs (làm con trỏ). */
  at: string;
  body: string;
  sender_name?: string;
  peer_id?: string | null;
  peer_name?: string;
  company_id?: string;
  company_name?: string;
};
/** `pattern` = chuỗi tìm ĐÃ thoát ` % _` (DB tự `hub.fold` + bọc `%…%`); keyset `(at, conversation_id, seq)` DESC; `limit` đã +1. */
export type SearchQuery = {
  pattern: string;
  conversationId: string | null;
  cur: { at: string; cid: string; seq: number } | null;
  limit: number;
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
export type RevokeRow = {
  sender_id: string;
  was_deleted: boolean;
  done: boolean;
  /** Mọi thành viên (người nhận `msg.deleted`). */
  member_ids: string[];
  /** Tệp của tin vừa thu hồi (đã soft-delete ở DB) — use case gỡ byte FileBox SAU commit. */
  gone: StoredFile[];
};
/** Tệp ở FileBox (org theo tenant + id trong FileBox). */
export type StoredFile = { org: string; file_id: string };
export type NewMsgFile = {
  id: string;
  cid: string;
  org: string;
  fileId: string;
  versionId: string;
  name: string;
  mime: string;
  size: number;
  by: string;
};
/** Kho byte (FileBox, org theo tenant). `remove` không ném khi đã mất. */
export type MsgFileStore = {
  put(org: string, name: string, bytes: Uint8Array): Promise<{ fileId: string; versionId: string }>;
  remove(org: string, fileId: string): Promise<void>;
  link(org: string, fileId: string): Promise<string | null>;
};
/** Kết quả đánh dấu đã đọc: mốc mới, mốc trước (không tiến ⇒ không phát `msg.read`), mọi thành viên. */
export type ReadRow = { seq: number; prev: number; member_ids: string[] };

export type MessagesRepo = {
  /** MỘT câu: nội bộ `UNION ALL` `pmsg_inbox`, mỗi nguồn LIMIT `limit`, sắp/LIMIT ngoài. */
  conversations(me: string, q: ListQuery): Promise<RawConversation[]>;
  conversation(me: string, cid: string): Promise<RawConversation | null>;
  /** Tổng chưa đọc (nội bộ + `partner`, đã kẹp 999) của người gọi — MỘT câu. */
  /** `withPartner=false` ⇒ chỉ nội bộ (người không có quyền Sổ Hợp Tác: `pmsg_unread` ném 42501 — use case chạy lại không có phần đối tác). */
  unread(me: string, withPartner?: boolean): Promise<number>;
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
  /** Tệp tải lên (chưa gửi): chèn `contracts.files` + `msg_files` (seq NULL) trong MỘT câu. */
  insertFile(f: NewMsgFile): Promise<void>;
  /** Tệp của hội thoại mà người gọi tải được: thành viên (RLS); tệp chưa gửi chỉ người tải lên. Không thấy ⇒ null. */
  fileRef(me: string, cid: string, fileId: string): Promise<StoredFile | null>;
  /** Mọi tệp còn sống của hội thoại (trước khi xoá hội thoại ⇒ gỡ byte). */
  convFiles(cid: string): Promise<StoredFile[]>;
  /** CR-178 M4 · tệp đã gửi của cuộc, mới nhất trước (RLS: chỉ thành viên; use case kiểm `facts` trước để phân biệt 404 với rỗng). */
  attachments(cid: string, q: AttachQuery): Promise<RawAttachment[]>;
  /** CR-178 M3 · tin khớp trong các cuộc nội bộ người gọi là thành viên (RLS), bỏ tin đã thu hồi, mới nhất trước. MỘT câu. */
  search(me: string, q: SearchQuery): Promise<RawSearchHit[]>;
  /** null = không phải thành viên. Trả mốc đọc mới + cũ + mọi thành viên (đã kẹp theo `clampRead`: không lùi, không vượt tin cuối). */
  markRead(me: string, cid: string, seq: number): Promise<ReadRow | null>;
};
export type PartnerPersonRow = {
  user_id: string;
  name: string;
  job_title: string | null;
  tenant_id: string;
  company_name: string;
  department_id: string | null;
  department_name: string | null;
  sort_key: string;
};
export type PartnerCompanyRow = { company_id: string; name: string; sort_key: string };
/** CR-169 · cuộc `partner` + danh bạ/công ty (hàm `hub.pmsg_*` DEFINER; người dùng lấy từ `app.user_id`, không là tham số). */
export type PartnerRepo = {
  /** `pmsg_open` — tạo/lấy cuộc với (tenant, user). */
  open(tenant: string, user: string): Promise<{ id: string; created: boolean }>;
  /** `pmsg_detail` — null ⇒ không là đầu cuộc (DB ném CC404 nên thực tế không bao giờ null). */
  detail(id: string): Promise<RawConversation | null>;
  /** `pmsg_people` — `tenants` null = A ∪ kết nối; keyset (sort_key, user_id); xin `limit` dòng (route xin +1). */
  people(q: {
    tenants: string[] | null;
    q: string | null;
    cur: { key: string; id: string } | null;
    limit: number;
  }): Promise<PartnerPersonRow[]>;
  companies(cur: { key: string; id: string } | null, limit: number): Promise<PartnerCompanyRow[]>;
  /** `pmsg_page` — trang tin mới → cũ (hàm tự tính `has_more`; limit kẹp 1..100). Không là đầu cuộc ⇒ DB ném CC404. */
  page(
    id: string,
    before: number | null,
    limit: number,
  ): Promise<{ items: RawMessage[]; has_more: boolean }>;
  /** `pmsg_send` — idempotent theo `clientId`; `notify` = hai đầu (tenant,user), rỗng khi gửi lặp. */
  send(m: { id: string; clientId: string; body: string; fileIds: string[] }): Promise<{
    seq: number;
    created: boolean;
    message: RawMessage;
    notify: { tenant_id: string; user_id: string }[];
  }>;
  /** `pmsg_delete` — thu hồi tin của mình; trả id FileBox cần gỡ byte (rỗng khi đã thu hồi trước đó). */
  remove(id: string, seq: number): Promise<string[]>;
  /** `pmsg_mark_read` — mốc đọc mới của người gọi (chỉ tiến, kẹp ≤ last_seq). */
  markRead(id: string, seq: number): Promise<number>;
  /** CR-178 M4 · `pmsg_files_list` — tệp đã gửi của cuộc (đọc được cả sau ngắt kết nối); không là đầu cuộc ⇒ DB ném CC404. */
  attachments(id: string, q: AttachQuery): Promise<RawAttachment[]>;
  /** CR-178 M3 · `pmsg_search` — tin khớp trong các cuộc `partner` người gọi là một đầu (kể cả sau ngắt kết nối). MỘT câu. */
  search(q: SearchQuery): Promise<RawSearchHit[]>;
  /** `hub.cc_connected(tenant người gọi, company)` — còn kết nối không (chọn mã 409 khi chặn tải lên sớm). */
  connected(company: string): Promise<boolean>;
  /** `pmsg_file_add` — ghi tệp tải lên (id/khoá do route sinh; `boxId` = id FileBox). CC404/CC409/CC422 do DB. */
  fileAdd(
    id: string,
    f: { fileId: string; boxId: string; name: string; mime: string; size: number; key: string },
  ): Promise<{ id: string; name: string; mime: string; size: number }>;
  /** `pmsg_file_get` — nơi lưu nội dung tệp của cuộc (khoá `<tenant>/<id>` + id FileBox); không thấy ⇒ null. */
  fileGet(id: string, fileId: string): Promise<{ key: string; boxId: string } | null>;
};
export type MessagesRepos = { messages: MessagesRepo; partner: PartnerRepo };

export type PeopleLookup = (
  who: { tenantId: string; userId: string },
  ids: readonly string[],
) => Promise<Map<string, { name: string; active: boolean }>>;
