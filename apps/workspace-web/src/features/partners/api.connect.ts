// CR-161 · gọi API kết nối hai công ty (`/pack/contracts/connect/**`). Chỉ người Toàn quyền gọi được (khác ⇒ 403 PACK_FORBIDDEN).
import type {
  CcFile,
  CcMessage,
  CcPost,
  CcSendBody,
  ConnectInviteResponseSchema,
  ConnectLink,
  ConnectListQuery,
  ConnectSearchResponseSchema,
} from "@ai/contracts/pack-contracts";
import { api, apiResponse } from "@ai/web-kit/http";
import type { z } from "zod";

const BASE = "/pack/contracts/connect";
const enc = encodeURIComponent;

export const connectKeys = {
  all: ["connect"] as const,
  search: (q: string) => ["connect", "search", q] as const,
  links: (status: string) => ["connect", "links", status] as const,
  thread: (other: string) => ["connect", "thread", other] as const,
  posts: (other: string) => ["connect", "posts", other] as const,
};

export const searchCompanies = (q: string, signal?: AbortSignal) =>
  api<z.infer<typeof ConnectSearchResponseSchema>>(`${BASE}/search?q=${enc(q)}`, { signal });
export const inviteCompany = (b: { tenant_id: string; note?: string }) =>
  api<z.infer<typeof ConnectInviteResponseSchema>>(`${BASE}/invites`, { method: "POST", body: b });
export const fetchLinks = (status: NonNullable<ConnectListQuery["status"]>, signal?: AbortSignal) =>
  api<{ items: ConnectLink[]; next_cursor: string | null }>(
    `${BASE}/links?status=${status}&limit=50`,
    { signal },
  );
export const acceptLink = (tenant: string) =>
  api<{ ok: true }>(`${BASE}/links/${enc(tenant)}/accept`, { method: "POST" });
export const declineLink = (tenant: string) =>
  api<{ ok: true }>(`${BASE}/links/${enc(tenant)}/decline`, { method: "POST" });
export const disconnectLink = (tenant: string) =>
  api<{ ok: true }>(`${BASE}/links/${enc(tenant)}`, { method: "DELETE" });

// ---------- Trò chuyện hai công ty (CR-161 lát 8) ----------
export type CcThreadPage = {
  items: CcMessage[];
  next_before: number | null;
  read_only: boolean;
  last_read_seq: number;
};
const thread = (other: string) => `${BASE}/threads/${enc(other)}`;

/** Trang tin: không `before` ⇒ trang mới nhất; `before=seq` ⇒ trang cũ hơn. */
export const fetchThread = (other: string, before: number | undefined, signal?: AbortSignal) =>
  api<CcThreadPage>(`${thread(other)}/messages`, {
    query: { limit: 30, ...(before ? { before } : {}) },
    signal,
  });
export const sendThreadMessage = (other: string, b: CcSendBody) =>
  api<{ message: CcMessage; created: boolean }>(`${thread(other)}/messages`, {
    method: "POST",
    body: b,
  });
export const markThreadRead = (other: string, seq: number) =>
  api<{ last_read_seq: number }>(`${thread(other)}/read`, { method: "POST", body: { seq } });
export function uploadThreadFile(other: string, file: File): Promise<CcFile> {
  const form = new FormData();
  form.append("file", file);
  return api<{ file: CcFile }>(`${thread(other)}/files`, {
    method: "POST",
    rawBody: form as unknown as Blob,
  }).then((r) => r.file);
}
/** `GET /connect/files/:id` trả 302 tới link FileBox ngắn hạn: theo chuyển hướng rồi lấy địa chỉ cuối (không đọc thân tệp). */
export async function fetchThreadFileUrl(fileId: string, signal?: AbortSignal): Promise<string> {
  const res = await apiResponse(`${BASE}/files/${enc(fileId)}`, { signal });
  void res.body?.cancel();
  if (!res.url) throw new Error("no link");
  return res.url;
}

export const fetchPosts = (other: string, cursor: string | null, signal?: AbortSignal) =>
  api<{ items: CcPost[]; next_cursor: string | null }>(`${BASE}/posts/${enc(other)}`, {
    query: { limit: 20, ...(cursor ? { cursor } : {}) },
    signal,
  });
