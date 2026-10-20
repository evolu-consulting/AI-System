// sso-switch · đăng nhập một lần giữa các web: phát mã một lần cho app đích (người gọi đã có Bearer) và đổi mã lấy phiên
// mới riêng của app đích (cookie `ai_rt_<app>`). Mọi lỗi đổi mã = UNAUTHORIZED (không lộ lý do: hết hạn / dùng lại /
// sai app / sai công ty / phiên nguồn đã thu hồi / tài khoản bị khoá đều như nhau).
import { createHash, randomBytes } from "node:crypto";
import { SSO_CODE_TTL_S, type SsoCodeResponse, type WebApp } from "@ai/contracts";
import { refreshTokens, type Tx, withScope } from "@ai/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Actor } from "../../../lib/auth-middleware";
import { appError } from "../../../lib/errors";
import * as repo from "../auth.repo";
import { canSignIn, normalizeLoginId } from "../auth.rules";
import { type AuthCtx, type ClientMeta, issueSession, type Session } from "../auth.session";
import type { SsoCodeStore } from "./sso.store";

export type SsoCtx = AuthCtx & { ssoStore: SsoCodeStore };

const TTL_MS = SSO_CODE_TTL_S * 1000;
const keyOf = (code: string): string => createHash("sha256").update(code).digest("hex");
const denied = () => appError("UNAUTHORIZED");

export async function issueSsoCode(
  ctx: SsoCtx,
  actor: Actor,
  app: WebApp,
): Promise<SsoCodeResponse> {
  if (!actor.sid) throw denied();
  const code = randomBytes(32).toString("base64url");
  const exp = ctx.now().getTime() + TTL_MS;
  await ctx.ssoStore.put(
    keyOf(code),
    { tid: actor.tenantId, sub: actor.userId, sid: actor.sid, app, exp },
    TTL_MS,
  );
  return { code, expires_in: SSO_CODE_TTL_S };
}

/** Phiên nguồn còn sống: chuỗi `family_id` còn token chưa thu hồi, chưa hết hạn (giờ DB). */
async function familyActive(tx: Tx, tenantId: string, familyId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tenantId, tenantId),
        eq(refreshTokens.familyId, familyId),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

export type RedeemInput = { code: string; app: WebApp | undefined; tenantKey?: string };

export async function redeemSsoCode(
  ctx: SsoCtx,
  input: RedeemInput,
  meta: ClientMeta,
): Promise<Session> {
  // Lấy-là-xoá trước mọi kiểm tra: mã đã trình ra thì không dùng lại được, kể cả khi bị từ chối.
  const e = await ctx.ssoStore.take(keyOf(input.code));
  if (!e || e.exp <= ctx.now().getTime() || !input.app || e.app !== input.app) throw denied();
  return withScope(ctx.db, { kind: "tenant", tenantId: e.tid }, async (tx) => {
    await repo.lockUserShared(tx, e.tid, e.sub);
    const u = await repo.findUserById(tx, e.tid, e.sub);
    if (!u || !canSignIn(u, u.tenant.active)) throw denied();
    if (input.tenantKey !== undefined && normalizeLoginId(input.tenantKey) !== u.tenant.key)
      throw denied();
    if (!(await familyActive(tx, e.tid, e.sid))) throw denied();
    return issueSession(ctx, tx, u, meta);
  });
}
