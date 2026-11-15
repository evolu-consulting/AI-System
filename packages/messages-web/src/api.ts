// CR-132 · W2 · gọi API tin nhắn Sổ Hợp Tác (`/pack/contracts/messages/**`, spec CR-132 §4). Chỉ file này gọi mạng.
import type {
  AddMembersRequest,
  ConversationDetail,
  ConversationPage,
  CreateConversationRequest,
  FileRef,
  Message,
  MessagePage,
  MsgPeoplePage,
  SendMessageRequest,
  UnreadResponse,
} from "@ai/contracts/pack-contracts";
import type { PeopleResponse, PersonCard } from "@ai/contracts/people";
import { messagesHost } from "./host";

const api = <T>(...a: Parameters<ReturnType<typeof messagesHost>["api"]>) =>
  messagesHost().api<T>(...a);

const BASE = "/pack/contracts/messages";
const conv = (id: string) => `${BASE}/conversations/${encodeURIComponent(id)}`;

export const msgKeys = {
  all: ["messages"] as const,
  unread: ["messages", "unread"] as const,
  list: ["messages", "list"] as const,
  detail: (id: string) => ["messages", "detail", id] as const,
  msgs: (id: string) => ["messages", "msgs", id] as const,
  people: (q: string) => ["messages", "people", q] as const,
};

export const fetchUnread = (signal?: AbortSignal) =>
  api<UnreadResponse>(`${BASE}/unread`, { signal });
/** CR-148 · mọi danh sách tải dần 30 dòng/lần (cursor; server giữ trần). */
export const MSG_LIST_PAGE = 30;
export const fetchConversations = (cursor: string | null, signal?: AbortSignal) =>
  api<ConversationPage>(`${BASE}/conversations`, {
    query: { limit: MSG_LIST_PAGE, ...(cursor ? { cursor } : {}) },
    signal,
  });
export const fetchConversation = (id: string, signal?: AbortSignal) =>
  api<ConversationDetail>(conv(id), { signal });
export const createConversation = (body: CreateConversationRequest) =>
  api<ConversationDetail>(`${BASE}/conversations`, { method: "POST", body });
export const renameConversation = (id: string, title: string) =>
  api<ConversationDetail>(conv(id), { method: "PATCH", body: { title } });
export const addMembers = (id: string, body: AddMembersRequest) =>
  api<ConversationDetail>(`${conv(id)}/members`, { method: "POST", body });
export const removeMember = (id: string, userId: string) =>
  api<void>(`${conv(id)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
export const fetchMessages = (id: string, beforeSeq: number | null, signal?: AbortSignal) =>
  api<MessagePage>(`${conv(id)}/messages`, {
    query: { limit: MSG_LIST_PAGE, ...(beforeSeq ? { before_seq: beforeSeq } : {}) },
    signal,
  });
export const sendMessage = (id: string, body: SendMessageRequest) =>
  api<Message>(`${conv(id)}/messages`, { method: "POST", body });
export const revokeMessage = (id: string, seq: number) =>
  api<void>(`${conv(id)}/messages/${seq}`, { method: "DELETE" });
export const markRead = (id: string, seq: number) =>
  api<{ unread_total: number }>(`${conv(id)}/read`, { method: "POST", body: { seq } });

/** Danh bạ nội bộ TẢI DẦN (theo phòng ban rồi tên; `q` lọc tên không dấu ở server). */
export const fetchPeople = (cursor: string | null, q: string, signal?: AbortSignal) =>
  api<MsgPeoplePage>(`${BASE}/people`, {
    query: { limit: MSG_LIST_PAGE, ...(cursor ? { cursor } : {}), ...(q ? { q } : {}) },
    signal,
  });

/** Thẻ người (avatar, phòng ban, chức vụ) THEO LÔ ≤ 50 id: hub `GET /people?ids=` — một lời gọi cho cả lô, không gọi từng người. */
export const fetchPersonCards = async (
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<PersonCard[]> =>
  (await api<PeopleResponse>("/people", { query: { ids: ids.join(",") }, signal })).items;

const fileBase = (id: string, fileId: string) => `${conv(id)}/files/${encodeURIComponent(fileId)}`;

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
