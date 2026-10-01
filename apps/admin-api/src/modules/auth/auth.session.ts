// ADM-FR-01, ADM-FR-02, ADM-NFR-01 · phát phiên: refresh token ngẫu nhiên 32 byte (DB chỉ lưu SHA-256),
// access token EdDSA có `sid` = family_id, và body TokenGrant.
import { createHash, randomBytes } from "node:crypto";
import type { Me, TokenGrant } from "@ai/contracts";
import type { Db, Tx } from "@ai/db";
import type { ClientKind } from "../../lib/http";
import type { JwtKeys } from "../../lib/jwt";
import { signAccessToken } from "../../lib/jwt";
import { type AuthUser, insertRefresh } from "./auth.repo";
import { ACCESS_TOKEN_TTL_S } from "./auth.rules";

export type AuthCtx = {
  db: Db;
  keys: JwtKeys;
  now: () => Date;
  dummyHash: string;
  /** Chỉ cho test backend: chạy giữa lúc đọc ảnh chụp user và lúc verify mật khẩu (tái hiện race khoá tạm). */
  beforeVerify?: () => Promise<void>;
};
export type ClientMeta = { client: ClientKind; userAgent: string | null };
/** Grant chưa gắn refresh token vào body: route quyết định cookie (web) hay body (extension). */
export type Session = { grant: Omit<TokenGrant, "refresh_token">; refreshToken: string };

const UA_MAX = 512;

export const sha256 = (token: string): Buffer => createHash("sha256").update(token).digest();

export function toMe(u: AuthUser): Me {
  return {
    id: u.id,
    tenant: { id: u.tenant.id, key: u.tenant.key, name: u.tenant.name },
    username: u.username,
    display_name: u.displayName,
    email: u.email,
    role: u.role,
    locale: u.locale,
    must_change_password: false,
  };
}

/** Chèn refresh token (đầu chuỗi khi không có `family`) rồi ký access token. Gọi trong withScope(tenant). */
export async function issueSession(
  ctx: AuthCtx,
  tx: Tx,
  u: AuthUser,
  o: ClientMeta & { id?: string; family?: { id: string; expiresAt: Date } },
): Promise<Session> {
  const id = o.id ?? Bun.randomUUIDv7();
  const refreshToken = randomBytes(32).toString("base64url");
  const familyId = o.family?.id ?? id;
  await insertRefresh(tx, {
    id,
    userId: u.id,
    tenantId: u.tenantId,
    familyId,
    tokenHash: sha256(refreshToken),
    client: o.client,
    userAgent: o.userAgent ? o.userAgent.slice(0, UA_MAX) : null,
    expiresAt: o.family?.expiresAt ?? null,
  });
  const accessToken = await signAccessToken(ctx.keys, {
    sub: u.id,
    tid: u.tenantId,
    role: u.role,
    sid: familyId,
  });
  return {
    refreshToken,
    grant: {
      status: "authenticated",
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S as TokenGrant["expires_in"],
      user: toMe(u),
    },
  };
}
