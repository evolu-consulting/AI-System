// CR-161 · gọi API kết nối hai công ty (CR-169: trò chuyện + Bảng tin đã chuyển sang gói `@ai/messages-web`) (`/pack/contracts/connect/**`). Chỉ người Toàn quyền gọi được (khác ⇒ 403 PACK_FORBIDDEN).
import type {
  ConnectCompanyPage,
  ConnectInviteBy,
  ConnectInviteResponseSchema,
  ConnectLink,
  ConnectListing,
  ConnectListQuery,
  ConnectSearchResponseSchema,
  ConnectSettings,
} from "@ai/contracts/pack-contracts";
import { api } from "@ai/web-kit/http";
import type { z } from "zod";

const BASE = "/pack/contracts/connect";
const enc = encodeURIComponent;

export const connectKeys = {
  all: ["connect"] as const,
  search: (q: string) => ["connect", "search", q] as const,
  links: (status: string) => ["connect", "links", status] as const,
  settings: ["connect", "settings"] as const,
  listing: ["connect", "listing"] as const,
  company: (id: string) => ["connect", "company", id] as const,
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
export const declineLink = (b: { tenant: string; reason?: string }) =>
  api<{ ok: true }>(`${BASE}/links/${enc(b.tenant)}/decline`, {
    method: "POST",
    body: b.reason ? { reason: b.reason } : {},
  });
export const withdrawInvite = (tenant: string) =>
  api<{ ok: true }>(`${BASE}/invites/${enc(tenant)}`, { method: "DELETE" });
export const fetchSettings = (signal?: AbortSignal) =>
  api<ConnectSettings>(`${BASE}/settings`, { signal });
export const saveSettings = (invite_by: ConnectInviteBy) =>
  api<{ ok: true }>(`${BASE}/settings`, { method: "PUT", body: { invite_by } });
export const fetchCompany = (id: string, signal?: AbortSignal) =>
  api<ConnectCompanyPage>(`${BASE}/companies/${enc(id)}`, { signal });
export const disconnectLink = (tenant: string) =>
  api<{ ok: true }>(`${BASE}/links/${enc(tenant)}`, { method: "DELETE" });
export const fetchListing = (signal?: AbortSignal) =>
  api<ConnectListing>(`${BASE}/listing`, { signal });
export const saveListing = (listed: boolean) =>
  api<ConnectListing>(`${BASE}/listing`, { method: "PUT", body: { listed } });
