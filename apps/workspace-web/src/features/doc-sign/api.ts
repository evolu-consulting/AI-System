// CR-181 · s12 · gọi API ký trên tài liệu: `/pack/contracts/contracts/:id/…` + chữ ký của tôi `/me/signature` (lõi).
import type { SignFieldsPut, SignSessionOut } from "@ai/contracts/pack-contracts";
import {
  type CreateSignatureBody,
  CreateSignatureBodySchema,
  type MySignatureView,
} from "@ai/contracts/signature";
import { api, apiResponse } from "@ai/web-kit/http";
import type { SignPostBody } from "./lib/session-map";

const base = (id: string) => `/pack/contracts/contracts/${encodeURIComponent(id)}`;
const doc = (id: string, fileId: string) => `${base(id)}/sign-docs/${encodeURIComponent(fileId)}`;

export const sessionKey = (id: string) => ["contract", id, "doc-sign-session"] as const;
export const mySignatureKey = ["me", "signature"] as const;

export const fetchSession = (id: string, signal?: AbortSignal) =>
  api<SignSessionOut>(`${base(id)}/doc-sign-session`, { signal });

export const patchNeedsSign = (id: string, fileId: string, needs_sign: boolean) =>
  api<void>(doc(id, fileId), { method: "PATCH", body: { needs_sign } });

export const putFields = (id: string, fileId: string, body: SignFieldsPut) =>
  api<void>(`${doc(id, fileId)}/fields`, { method: "PUT", body });

export const postSign = (id: string, fileId: string, body: SignPostBody) =>
  api<{ version_id: string; seq: number; my_open_fields_left: number }>(`${doc(id, fileId)}/sign`, {
    method: "POST",
    body,
  });

/** PDF của bản mới nhất (gốc hoặc đã ký) để vẽ lên màn. */
export async function fetchContent(id: string, fileId: string, versionId: string | null) {
  const path = versionId
    ? `${doc(id, fileId)}/versions/${encodeURIComponent(versionId)}/content`
    : `${doc(id, fileId)}/content`;
  return (await apiResponse(path)).arrayBuffer();
}

export const fetchMySignature = (signal?: AbortSignal) =>
  api<MySignatureView>("/me/signature", { signal });

/** `POST /me/signature` (lõi): body `{ kind, method, png }`, png = base64 thuần; parse bằng schema trước khi gửi. */
export const saveMySignature = (body: CreateSignatureBody) =>
  api<void>("/me/signature", { method: "POST", body: CreateSignatureBodySchema.parse(body) });
