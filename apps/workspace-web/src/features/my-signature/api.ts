// CR-181 · s4 · gọi API «Chữ ký của tôi» (chỉ ở đây): xem, tạo, xin đổi. Không có tham số người dùng (BR-K2).
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
