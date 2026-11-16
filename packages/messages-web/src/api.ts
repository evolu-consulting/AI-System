// CR-132 · W2 · gọi API tin nhắn Sổ Hợp Tác (`/pack/contracts/messages/**`, spec CR-132 §4). Chỉ file này gọi mạng.
import type {
  AddMembersRequest,
  CcPost,
  ConversationDetail,
  ConversationPage,
  CreateConversationRequest,
  FileRef,
  Message,
  MessagePage,
  MsgAttachKind,
  MsgAttachmentPage,
  MsgCompanyPage,
  MsgPeoplePage,
  MsgSearchPage,
  SendMessageRequest,
  UnreadResponse,
} from "@ai/contracts/pack-contracts";
import type { PeopleResponse, PersonCard } from "@ai/contracts/people";
import { ApiError } from "@ai/web-kit/http";
import { messagesHost } from "./host";
import { type CompanyFilter, filterParam } from "./lib/company-filter";
import { isPartnerId, rememberKind, rememberKinds } from "./lib/kinds";

const api = <T>(...a: Parameters<ReturnType<typeof messagesHost>["api"]>) =>
  messagesHost().api<T>(...a);

const BASE = "/pack/contracts/messages";
const enc = encodeURIComponent;
const internal = (id: string) => `${BASE}/conversations/${enc(id)}`;
const partner = (id: string) => `${BASE}/partner/${enc(id)}`;
/** CR-169 · cuộc `partner` (công ty đã kết nối) đi đường riêng; còn lại như CR-132 (loại nhớ từ danh sách/chi tiết/tạo mới). */
const conv = (id: string) => (isPartnerId(id) ? partner(id) : internal(id));

export const msgKeys = {
  all: ["messages"] as const,
  unread: ["messages", "unread"] as const,
  list: ["messages", "list"] as const,
  /** Danh sách theo bộ lọc công ty (`msgKeys.list` là tiền tố ⇒ làm mới/ghi cache cho mọi bộ lọc). */
  listBy: (f: CompanyFilter, unread = false) =>
    unread ? (["messages", "list", f, "unread"] as const) : (["messages", "list", f] as const),
  detail: (id: string) => ["messages", "detail", id] as const,
  msgs: (id: string) => ["messages", "msgs", id] as const,
  people: (q: string, f: CompanyFilter = "own") => ["messages", "people", f, q] as const,
  companies: ["messages", "companies"] as const,
  search: (q: string, conv: string | null) => ["messages", "search", conv ?? "all", q] as const,
  attach: (id: string, kind: MsgAttachKind) => ["messages", "attach", id, kind] as const,
  feed: (tenant: string) => ["messages", "feed", tenant] as const,
};

export const fetchUnread = (signal?: AbortSignal) =>
  api<UnreadResponse>(`${BASE}/unread`, { signal });
/** CR-148 · mọi danh sách tải dần 30 dòng/lần (cursor; server giữ trần). */
export const MSG_LIST_PAGE = 30;
export const fetchConversations = async (
  cursor: string | null,
  filter: CompanyFilter,
  signal?: AbortSignal,
  unread = false,
) => {
  const company = filterParam(filter);
  const page = await api<ConversationPage>(`${BASE}/conversations`, {
    query: {
      limit: MSG_LIST_PAGE,
      ...(cursor ? { cursor } : {}),
      ...(company ? { company } : {}),
      ...(unread ? { unread: "true" } : {}),
    },
    signal,
  });
  rememberKinds(page.items);
  return page;
};
/** Id chưa biết loại (mở thẳng từ đường dẫn) ⇒ thử nội bộ, không thấy (404) ⇒ thử `partner`. */
export async function fetchConversation(id: string, signal?: AbortSignal) {
  const known = isPartnerId(id);
  try {
    const d = await api<ConversationDetail>(known ? partner(id) : internal(id), { signal });
    rememberKind(d.id, d.kind);
    return d;
  } catch (e) {
    if (known || !(e instanceof ApiError) || e.status !== 404) throw e;
    const d = await api<ConversationDetail>(partner(id), { signal });
    rememberKind(d.id, d.kind);
    return d;
  }
}
export const createConversation = async (body: CreateConversationRequest) => {
  const d = await api<ConversationDetail>(`${BASE}/conversations`, { method: "POST", body });
  rememberKind(d.id, d.kind);
  return d;
};
export const renameConversation = (id: string, title: string) =>
  api<ConversationDetail>(internal(id), { method: "PATCH", body: { title } });
export const addMembers = (id: string, body: AddMembersRequest) =>
  api<ConversationDetail>(`${internal(id)}/members`, { method: "POST", body });
export const removeMember = (id: string, userId: string) =>
  api<void>(`${internal(id)}/members/${enc(userId)}`, { method: "DELETE" });
/** Trang tin: `aroundSeq` ⇒ nhảy tới tin đó (CR-178; kèm `has_newer`), còn lại tải thêm tin cũ hơn `beforeSeq`. */
/** Trang tin: `aroundSeq` ⇒ nhảy tới tin đó (CR-178; kèm `has_newer`), còn lại tải thêm tin cũ hơn `beforeSeq`. */
export const fetchMessages = (
  id: string,
  beforeSeq: number | null,
  signal?: AbortSignal,
  aroundSeq?: number,
) =>
  api<MessagePage>(`${conv(id)}/messages`, {
    query: {
      limit: MSG_LIST_PAGE,
      ...(aroundSeq ? { around_seq: aroundSeq } : beforeSeq ? { before_seq: beforeSeq } : {}),
    },
    signal,
  });
export const sendMessage = (id: string, body: SendMessageRequest) =>
  api<Message>(`${conv(id)}/messages`, { method: "POST", body });
export const revokeMessage = (id: string, seq: number) =>
  api<void>(`${conv(id)}/messages/${seq}`, { method: "DELETE" });
export const markRead = (id: string, seq: number) =>
  api<{ unread_total: number }>(`${conv(id)}/read`, { method: "POST", body: { seq } });

/**
 * Danh bạ TẢI DẦN (`q` lọc tên/chức vụ không dấu ở server). `own` (mặc định, như CR-148) theo phòng ban rồi tên; `all`/công ty kết nối
 * (CR-169) theo tên, người có quyền Sổ Hợp Tác — chỉ lộ tên, chức vụ, công ty.
 */
export const fetchPeople = (
  cursor: string | null,
  q: string,
  signal?: AbortSignal,
  filter: CompanyFilter = "own",
) =>
  api<MsgPeoplePage>(`${BASE}/people`, {
    query: {
      limit: MSG_LIST_PAGE,
      ...(cursor ? { cursor } : {}),
      ...(q ? { q } : {}),
      company: filter,
    },
    signal,
  });

/** Công ty đã kết nối (chip lọc, «Công ty khác»), tải dần 30/lần. */
export const fetchCompanies = (cursor: string | null, signal?: AbortSignal) =>
  api<MsgCompanyPage>(`${BASE}/companies`, {
    query: { limit: MSG_LIST_PAGE, ...(cursor ? { cursor } : {}) },
    signal,
  });

/** Bảng tin công khai của công ty đã kết nối (`GET /connect/posts/:tenant_id`, đã che; chỉ chữ + số tệp), tải dần 20/lần. */
export const FEED_PAGE = 20;
export const fetchFeed = (tenant: string, cursor: string | null, signal?: AbortSignal) =>
  api<{ items: CcPost[]; next_cursor: string | null }>(
    `/pack/contracts/connect/posts/${enc(tenant)}`,
    {
      query: { limit: FEED_PAGE, ...(cursor ? { cursor } : {}) },
      signal,
    },
  );

/** Thẻ người (avatar, phòng ban, chức vụ) THEO LÔ ≤ 50 id: hub `GET /people?ids=` — một lời gọi cho cả lô, không gọi từng người. */
export const fetchPersonCards = async (
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<PersonCard[]> =>
  (await api<PeopleResponse>("/people", { query: { ids: ids.join(",") }, signal })).items;

const fileBase = (id: string, fileId: string) => `${conv(id)}/files/${enc(fileId)}`;

/** `POST …/files` (multipart `file`) ⇒ 201 `FileRef` (tệp gắn vào hội thoại, chưa gửi). 415/413 ⇒ mã `MSG_FILE_TYPE`/`MSG_FILE_TOO_LARGE`. */
export function uploadFile(id: string, file: File): Promise<FileRef> {
  const form = new FormData();
  form.append("file", file);
  return api<FileRef>(`${conv(id)}/files`, { method: "POST", rawBody: form as unknown as Blob });
}

/** `GET …/files/:fileId/link` (Bearer) ⇒ link ngắn hạn tới FileBox: dùng thẳng cho `<img src>` / mở tab (không fetch xuyên origin ⇒ không cần CORS). */
export async function fetchFileLink(
  id: string,
  fileId: string,
  signal?: AbortSignal,
): Promise<string> {
  const { url } = await api<{ url: string }>(`${fileBase(id, fileId)}/link`, { signal });
  if (!/^https?:\/\//.test(url) && !/^\/(?!\/)/.test(url)) throw new Error("bad link");
  return url;
}

/** CR-178 · tìm tin (mọi cuộc, hoặc một cuộc khi có `conversationId`), tải dần 20/lần. */
export const fetchSearch = (
  q: string,
  conversationId: string | null,
  cursor: string | null,
  signal?: AbortSignal,
) =>
  api<MsgSearchPage>(`${BASE}/search`, {
    query: {
      q,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      ...(cursor ? { cursor } : {}),
    },
    signal,
  });

/** CR-178 · «Ảnh & tệp» của một cuộc (nội bộ và `partner`), tải dần 30/lần. */
export const fetchAttachments = (
  id: string,
  kind: MsgAttachKind,
  cursor: string | null,
  signal?: AbortSignal,
) =>
  api<MsgAttachmentPage>(`${conv(id)}/attachments`, {
    query: { kind, ...(cursor ? { cursor } : {}) },
    signal,
  });

/** CR-178 · tải byte tệp về (link ngắn hạn, không gửi cookie) và gắn đúng loại `mime` của tệp đã lưu ⇒ blob để xem trước; hỏng ⇒ ném lỗi. */
export async function fetchFileBlob(
  id: string,
  fileId: string,
  mime: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const url = await fetchFileLink(id, fileId, signal);
  const res = await fetch(url, { credentials: "omit", ...(signal ? { signal } : {}) });
  if (!res.ok) throw new Error("file fetch failed");
  return new Blob([await res.arrayBuffer()], { type: mime });
}
