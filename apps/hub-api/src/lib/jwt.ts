// HUB-FR-89 · Xác thực access token (EdDSA, như Admin + role ∈ ROLES) (plan §6.4). Stub B0.
import type { Role } from "@ai/contracts";

export type AccessClaims = { sub: string; tid: string; role: Role; sid: string | null };

export async function verifyAccessToken(
  _key: CryptoKey,
  _token: string,
): Promise<AccessClaims | null> {
  throw new Error("not implemented");
}
