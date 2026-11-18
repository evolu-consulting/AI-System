// CR-182 · gọi API công khai `/sign-link/:token/*` (KHÔNG JWT, không vòng refresh). CSRF kép: cookie httpOnly đặt ở GET + header `x-sign-csrf` = giá trị `csrf` trong thân GET.

import type { PartnerSignSaveOut } from "@ai/contracts/pack-contracts";
import { ApiError, sendPublic } from "@ai/web-kit/http";
import { filePath, linkBase, versionPath } from "./lib/partner-map";
import type { PartnerSignPort, PartnerSignView } from "./ports";

const post = <T>(token: string, path: string, csrf: string, body: unknown) =>
  sendPublic<T>(`${linkBase(token)}/${path}`, {
    method: "POST",
    body,
    headers: { "x-sign-csrf": csrf },
  });

async function pdf(path: string): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", referrerPolicy: "no-referrer" });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Network error");
  }
  if (!res.ok) throw new ApiError(res.status, "HTTP_ERROR", res.statusText);
  return res.arrayBuffer();
}

export function partnerSignPort(token: string): PartnerSignPort {
  return {
    view: (signal) => sendPublic<PartnerSignView>(linkBase(token), { signal }),
    quickSignature: (csrf, method, png) =>
      post<void>(token, "quick-signature", csrf, { method, png }),
    sign: (csrf, body) => post<PartnerSignSaveOut>(token, "sign", csrf, body),
    decline: (csrf, reason) => post<void>(token, "decline", csrf, { reason }),
    content: (fileId, versionId) =>
      pdf(versionId ? versionPath(token, fileId, versionId) : filePath(token, fileId)),
    signedUrl: (fileId, versionId) => versionPath(token, fileId, versionId),
  };
}
