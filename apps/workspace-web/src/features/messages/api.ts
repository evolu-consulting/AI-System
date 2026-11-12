// CR-132 · W2 · gọi API tin nhắn Sổ Hợp Tác (`/pack/contracts/messages/**`, spec CR-132 §4). Chỉ file này gọi mạng.
import type {
  AddMembersRequest,
  ConversationDetail,
  ConversationPage,
  CreateConversationRequest,
  FileRef,
  Message,
  MessagePage,
  SendMessageRequest,
  UnreadResponse,
} from "@ai/contracts/pack-contracts";
import { api, apiResponse } from "@ai/web-kit/http";

const BASE = "/pack/contracts/messages";
const conv = (id: string) => `${BASE}/conversations/${encodeURIComponent(id)}`;

export const msgKeys = {
  all: ["messages"] as const,
  unread: ["messages", "unread"] as const,
  list: ["messages", "list"] as const,
  detail: (id: string) => ["messages", "detail", id] as const,
  msgs: (id: string) => ["messages", "msgs", id] as const,
  people: ["messages", "people"] as const,
};

export const fetchUnread = (signal?: AbortSignal) =>
  api<UnreadResponse>(`${BASE}/unread`, { signal });
export const fetchConversations = (cursor: string | null, signal?: AbortSignal) =>
  api<ConversationPage>(`${BASE}/conversations`, {
    query: cursor ? { cursor } : undefined,
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
    query: beforeSeq ? { before_seq: beforeSeq } : undefined,
    signal,
  });
export const sendMessage = (id: string, body: SendMessageRequest) =>
  api<Message>(`${conv(id)}/messages`, { method: "POST", body });
export const revokeMessage = (id: string, seq: number) =>
  api<void>(`${conv(id)}/messages/${seq}`, { method: "DELETE" });
export const markRead = (id: string, seq: number) =>
  api<{ unread_total: number }>(`${conv(id)}/read`, { method: "POST", body: { seq } });

/** Người nội bộ chọn được (cùng nguồn «người có thể được giao»; tra MỘT lần, lọc ở máy khách). */
export const fetchPeople = (signal?: AbortSignal) =>
  api<{ items: { id: string; name: string }[] }>("/pack/contracts/assignees", { signal });

const fileBase = (id: string, fileId: string) => `${conv(id)}/files/${encodeURIComponent(fileId)}`;

/** `POST …/files` (multipart `file`) ⇒ 201 `FileRef` (tệp gắn vào hội thoại, chưa gửi). 415/413 ⇒ mã `MSG_FILE_TYPE`/`MSG_FILE_TOO_LARGE`. */
export function uploadFile(id: string, file: File): Promise<FileRef> {
  const form = new FormData();
  form.append("file", file);
  return api<FileRef>(`${conv(id)}/files`, { method: "POST", rawBody: form as unknown as Blob });
}

/** `GET …/files/:fileId` (Bearer; 302 tới FileBox) ⇒ blob. */
export async function fetchFileBlob(
  id: string,
  fileId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return (await apiResponse(fileBase(id, fileId), { signal })).blob();
}
