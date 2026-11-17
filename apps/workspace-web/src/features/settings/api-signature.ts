// CR-181 · s5 · Cài đặt › Chữ ký: `GET/PUT /company/signature-settings`, `GET /company/signature-change-requests`,
// `POST /company/signature-change-grants` (chỉ quản trị sửa/cho phép; mọi thành viên xem được cài đặt).
import type {
  GrantChangeResponse,
  SignatureChangeList,
  SignatureSettings,
  SignatureSettingsView,
} from "@ai/contracts/signature";
import { api } from "@ai/web-kit/http";

export const signatureKeys = {
  settings: ["settings", "signature"] as const,
  requests: ["settings", "signature-requests"] as const,
};

export const fetchSignatureSettings = (signal?: AbortSignal) =>
  api<SignatureSettingsView>("/company/signature-settings", { signal });
export const saveSignatureSettings = (body: SignatureSettings) =>
  api<SignatureSettingsView>("/company/signature-settings", { method: "PUT", body });
export const fetchChangeRequests = (signal?: AbortSignal) =>
  api<SignatureChangeList>("/company/signature-change-requests?limit=50", { signal });
export const grantChange = (user_id: string) =>
  api<GrantChangeResponse>("/company/signature-change-grants", {
    method: "POST",
    body: { user_id },
  });
