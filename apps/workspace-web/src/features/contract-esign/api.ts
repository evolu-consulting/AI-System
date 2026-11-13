// cf-esign-docusign · API ký số (trung lập nhà cung cấp): trạng thái, gửi ký, Ký ngay, làm mới, huỷ, bản đã ký, cài đặt bật/tắt.
import type {
  ESignSettingsIn,
  ESignSettingsOut,
  ESignSignerIn,
  ESignStateOut,
} from "@ai/contracts/pack-contracts";
import { api } from "@ai/web-kit/http";

const base = (id: string) => `/pack/contracts/contracts/${encodeURIComponent(id)}/esign`;
export const esignKey = (id: string) => ["contracts", "esign", id] as const;
export const esignSettingsKey = ["contracts", "esign", "settings"] as const;

export const fetchEsign = (id: string, signal?: AbortSignal) =>
  api<ESignStateOut>(base(id), { ...(signal ? { signal } : {}) });
export const sendEsign = (id: string, signers: ESignSignerIn[], provider?: string) =>
  api<ESignStateOut>(base(id), {
    method: "POST",
    body: { signers, ...(provider ? { provider } : {}) },
  });
export const refreshEsign = (id: string) =>
  api<ESignStateOut>(`${base(id)}/refresh`, { method: "POST" });
export const voidEsign = (id: string, reason: string) =>
  api<ESignStateOut>(`${base(id)}/void`, { method: "POST", body: { reason } });
export const signUrl = (id: string, returnUrl: string, provider?: string) =>
  api<{ url: string }>(`${base(id)}/sign-url`, {
    method: "POST",
    body: { return_url: returnUrl, ...(provider ? { provider } : {}) },
  });
export const signedLink = (id: string) => api<{ url: string }>(`${base(id)}/signed-link`);
export const fetchEsignSettings = () => api<ESignSettingsOut>("/pack/contracts/esign/settings");
export const saveEsignSettings = (patch: ESignSettingsIn) =>
  api<ESignSettingsOut>("/pack/contracts/esign/settings", { method: "PUT", body: patch });

// CR-141 · bước «Ký hợp đồng»: tải lên bản đã ký (thay cho ký số). `override` = người Toàn quyền tải thay người được giao.
export type SignedUploadStateOut = { awaiting: boolean; can_upload: boolean; override: boolean };
export type SignedUploadOut = { id: string; name: string; override: boolean };
const upBase = (id: string) => `/pack/contracts/contracts/${encodeURIComponent(id)}/signed-upload`;
export const signedUploadKey = (id: string) => ["contracts", "signed-upload", id] as const;
export const fetchSignedUpload = (id: string, signal?: AbortSignal) =>
  api<SignedUploadStateOut>(upBase(id), { ...(signal ? { signal } : {}) });
export function uploadSigned(id: string, file: File): Promise<SignedUploadOut> {
  const form = new FormData();
  form.append("file", file);
  return api<SignedUploadOut>(upBase(id), { method: "POST", rawBody: form as unknown as Blob });
}
