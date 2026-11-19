// CR-181 · s4 · gọi API «Chữ ký của tôi» (chỉ ở đây): xem, tạo, xin đổi. Không có tham số người dùng (BR-K2).

import type { SigDocKind, SigDocsResponse } from "@ai/contracts/pack-contracts";
import type {
  ChangeRequestResponse,
  CreateSignatureResponse,
  MySignatureView,
  SignatureKind,
  SignatureMethod,
} from "@ai/contracts/signature";
import { api } from "@ai/web-kit/http";

export const mySignatureKey = ["my-signature"] as const;

export const fetchMySignature = (signal?: AbortSignal) =>
  api<MySignatureView>("/me/signature", { signal });

/** Blob PNG → base64 thuần (không tiền tố data URL), đúng `CreateSignatureBodySchema.png`. */
export async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export async function createSignature(
  kind: SignatureKind,
  method: SignatureMethod,
  png: Blob,
  caption: string | null = null,
) {
  return api<CreateSignatureResponse>("/me/signature", {
    method: "POST",
    body: { kind, method, png: await blobToBase64(png), caption },
  });
}

export const requestSignatureChange = () =>
  api<ChangeRequestResponse>("/me/signature/change-request", { method: "POST" });

/** CR-188 · BR-188-5 · giấy tờ đã ký bằng một phiên bản chữ ký (lọc loại + khoảng ngày, 50/trang theo con trỏ). */
export type SigDocsFilter = { kind: SigDocKind | ""; from: string; to: string };
export const sigDocsKey = (sigId: string, f: SigDocsFilter) =>
  ["my-signature", "documents", sigId, f] as const;

export function fetchSigDocs(
  sigId: string,
  f: SigDocsFilter,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const q = new URLSearchParams();
  if (f.kind) q.set("kind", f.kind);
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (cursor) q.set("cursor", cursor);
  const qs = q.size ? `?${q}` : "";
  return api<SigDocsResponse>(
    `/pack/contracts/my-signatures/${encodeURIComponent(sigId)}/documents${qs}`,
    { signal },
  );
}
