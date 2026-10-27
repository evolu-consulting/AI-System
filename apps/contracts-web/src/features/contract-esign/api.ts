// cf-esign-docusign · API ký số (trung lập nhà cung cấp): trạng thái, gửi ký, Ký ngay, làm mới, huỷ, bản đã ký, cài đặt bật/tắt.
import type { ESignSettingsOut, ESignSignerIn, ESignStateOut } from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const base = (id: string) => `/pack/contracts/contracts/${encodeURIComponent(id)}/esign`;
export const esignKey = (id: string) => ["contracts", "esign", id] as const;
export const esignSettingsKey = ["contracts", "esign", "settings"] as const;

export const fetchEsign = (id: string, signal?: AbortSignal) =>
  api<ESignStateOut>(base(id), { ...(signal ? { signal } : {}) });
export const sendEsign = (id: string, signers: ESignSignerIn[]) =>
  api<ESignStateOut>(base(id), { method: "POST", body: { signers } });
export const refreshEsign = (id: string) =>
  api<ESignStateOut>(`${base(id)}/refresh`, { method: "POST" });
export const voidEsign = (id: string, reason: string) =>
  api<ESignStateOut>(`${base(id)}/void`, { method: "POST", body: { reason } });
export const signUrl = (id: string, returnUrl: string) =>
  api<{ url: string }>(`${base(id)}/sign-url`, { method: "POST", body: { return_url: returnUrl } });
export const signedLink = (id: string) => api<{ url: string }>(`${base(id)}/signed-link`);
export const fetchEsignSettings = () => api<ESignSettingsOut>("/pack/contracts/esign/settings");
export const saveEsignSettings = (enabled: boolean) =>
  api<ESignSettingsOut>("/pack/contracts/esign/settings", { method: "PUT", body: { enabled } });
