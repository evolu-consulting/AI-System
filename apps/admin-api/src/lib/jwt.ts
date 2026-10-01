// ADM-FR-01, ADM-FR-06, ADM-NFR-01 · JWT EdDSA (spec M1 §3 "Token", M1-R02): access token + change_token.
// Hai loại tách bằng `aud` nên không dùng lẫn được. iat/exp theo giờ thật (plan §10 G7).
import { type Role, UuidSchema } from "@ai/contracts";
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";

export type JwtKeys = { privateKey: CryptoKey; publicKey: CryptoKey; kid: string };

const ALG = "EdDSA";
export const ISSUER = "admin";
export const ACCESS_AUDIENCE = "ai-system";
export const CHANGE_AUDIENCE = "admin:password-change";
const ACCESS_TTL_S = 900;
const CHANGE_TTL_S = 300;

/** `sid` = family_id của phiên; token thiếu `sid` vẫn hợp lệ (Hub bỏ qua), khi đó `sid=null`. */
export type AccessClaims = { sub: string; tid: string; role: Role; sid: string | null };
export type ChangeClaims = { sub: string; tid: string; pwc: number };

/** PEM PKCS8/SPKI Ed25519. Ký thử + verify thử: cặp khoá lệch → ném Error (không in khoá). */
export async function loadJwtKeys(env: {
  JWT_PRIVATE_KEY: string;
  JWT_PUBLIC_KEY: string;
  JWT_KID: string;
}): Promise<JwtKeys> {
  const keys: JwtKeys = {
    privateKey: await importPKCS8(env.JWT_PRIVATE_KEY, ALG),
    publicKey: await importSPKI(env.JWT_PUBLIC_KEY, ALG),
    kid: env.JWT_KID,
  };
  const probe = await sign(keys, { probe: 1 }, "probe", "probe", 60);
  try {
    await jwtVerify(probe, keys.publicKey, { algorithms: [ALG], audience: "probe" });
  } catch {
    throw new Error("JWT_PRIVATE_KEY và JWT_PUBLIC_KEY không cùng một cặp khoá");
  }
  return keys;
}

function sign(
  keys: JwtKeys,
  claims: Record<string, unknown>,
  sub: string,
  aud: string,
  ttlS: number,
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: ALG, kid: keys.kid })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(aud)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlS)
    .sign(keys.privateKey);
}

export function signAccessToken(keys: JwtKeys, c: AccessClaims): Promise<string> {
  return sign(keys, { tid: c.tid, role: c.role, sid: c.sid }, c.sub, ACCESS_AUDIENCE, ACCESS_TTL_S);
}

export function signChangeToken(keys: JwtKeys, c: ChangeClaims): Promise<string> {
  return sign(keys, { tid: c.tid, pwc: c.pwc }, c.sub, CHANGE_AUDIENCE, CHANGE_TTL_S);
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
// sub/tid đi vào set_config + ép ::uuid: không phải uuid thì coi như token hỏng (tránh lỗi 22P02 → 500).
const isUuid = (v: unknown): v is string => UuidSchema.safeParse(v).success;

async function verify(keys: JwtKeys, token: string, aud: string) {
  try {
    const { payload } = await jwtVerify(token, keys.publicKey, {
      algorithms: [ALG],
      issuer: ISSUER,
      audience: aud,
      requiredClaims: ["sub", "iat", "exp"],
    });
    return payload;
  } catch {
    return null;
  }
}

/** Token sai chữ ký/hết hạn/sai aud/thiếu claim → null. `role` claim chỉ để Hub; Admin đọc role từ DB. */
export async function verifyAccessToken(
  keys: JwtKeys,
  token: string,
): Promise<AccessClaims | null> {
  const p = await verify(keys, token, ACCESS_AUDIENCE);
  if (!p || !isUuid(p.sub) || !isUuid(p.tid) || !isStr(p.role)) return null;
  return { sub: p.sub, tid: p.tid, role: p.role as Role, sid: isStr(p.sid) ? p.sid : null };
}

export async function verifyChangeToken(
  keys: JwtKeys,
  token: string,
): Promise<ChangeClaims | null> {
  const p = await verify(keys, token, CHANGE_AUDIENCE);
  if (!p || !isUuid(p.sub) || !isUuid(p.tid) || typeof p.pwc !== "number") return null;
  return { sub: p.sub, tid: p.tid, pwc: p.pwc };
}
