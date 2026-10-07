// HUB-FR-01, HUB-FR-74 · H1-R02 · xác thực access token do Admin phát (EdDSA, plan §1 P4, §6.4).
// CHÉP phần verify của `apps/admin-api/src/lib/jwt.ts` (không import chéo app); nợ: gộp vào `packages/auth`.
// Hub chỉ cần khoá công khai — không ký token.
import { ROLES, type Role, UuidSchema } from "@ai/contracts";
import { importSPKI, jwtVerify } from "jose";

const ALG = "EdDSA";
export const ISSUER = "admin";
export const ACCESS_AUDIENCE = "ai-system";

/** `sid` = family_id phiên Admin; Hub không dùng, giữ để khớp dạng claims của Admin. */
/** `exp` (giây epoch) — X2a D14: `/me/stream` đóng lúc token hết hạn. */
export type AccessClaims = {
  sub: string;
  tid: string;
  role: Role;
  sid: string | null;
  exp: number;
};

/** PEM SPKI Ed25519 (`JWT_PUBLIC_KEY`) → CryptoKey. Sai định dạng → ném (server exit 1). */
export function importJwtPublicKey(pem: string): Promise<CryptoKey> {
  return importSPKI(pem, ALG);
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
// sub/tid đi vào set_config + ép ::uuid: không phải uuid thì coi như token hỏng (tránh 22P02 → 500).
const isUuid = (v: unknown): v is string => UuidSchema.safeParse(v).success;
const isRole = (v: unknown): v is Role => (ROLES as readonly unknown[]).includes(v);

/** Sai chữ ký / alg khác EdDSA / hết hạn / sai iss|aud / thiếu claim / role ngoài ROLES → null. */
export async function verifyAccessToken(
  key: CryptoKey,
  token: string,
): Promise<AccessClaims | null> {
  let p: Record<string, unknown>;
  try {
    ({ payload: p } = await jwtVerify(token, key, {
      algorithms: [ALG],
      issuer: ISSUER,
      audience: ACCESS_AUDIENCE,
      requiredClaims: ["sub", "iat", "exp"],
    }));
  } catch {
    return null;
  }
  if (!isUuid(p.sub) || !isUuid(p.tid) || !isRole(p.role)) return null;
  if (typeof p.exp !== "number") return null;
  return { sub: p.sub, tid: p.tid, role: p.role, sid: isStr(p.sid) ? p.sid : null, exp: p.exp };
}
