// ADM-FR-02, ADM-FR-03, ADM-NFR-01 · refresh xoay vòng và đăng xuất (plan M1 §5). Tách khỏi auth.service (L1c, check:size ≤ 400).
// Không biết HTTP: route quyết định cookie/body. Mỗi bước có DB = một withScope.
import { NIL_SCOPE, setScope, type Tx, withScope } from "@ai/db";
import { appError } from "../../lib/errors";
import type { AuthUser } from "./auth.repo";
import * as repo from "./auth.repo";
import { canSignIn, classifyRefresh } from "./auth.rules";
import { type AuthCtx, type ClientMeta, issueSession, type Session, sha256 } from "./auth.session";

const tenantScope = (tenantId: string) => ({ kind: "tenant", tenantId }) as const;
type FoundRefresh = { tid: string; token: repo.RefreshRow; user: AuthUser | null };

async function findRefreshToken(ctx: AuthCtx, hash: Buffer): Promise<FoundRefresh | null> {
  return withScope(ctx.db, NIL_SCOPE, async (tx) => {
    const tid = await repo.tenantIdByRefreshHash(tx, hash);
    if (!tid) return null;
    await setScope(tx, tenantScope(tid));
    const token = await repo.findRefresh(tx, tid, hash);
    if (!token) return null;
    return { tid, token, user: await repo.findUserById(tx, tid, token.userId) };
  });
}

async function rotate(
  ctx: AuthCtx,
  f: FoundRefresh,
  u: AuthUser,
  meta: ClientMeta,
): Promise<Session> {
  return withScope(ctx.db, tenantScope(f.tid), async (tx: Tx) => {
    await repo.lockUserShared(tx, f.tid, u.id);
    // Đọc lại dưới khoá: user có thể vừa bị khoá/tenant khoá trước khi ta giữ được hàng.
    const fresh = await repo.findUserById(tx, f.tid, u.id);
    if (!fresh || !canSignIn(fresh, fresh.tenant.active)) throw appError("INVALID_REFRESH_TOKEN");
    const id = Bun.randomUUIDv7();
    // Request song song thua race: UPDATE chờ khoá hàng rồi thấy revoked_at đã đặt → 0 hàng.
    if (!(await repo.rotateRefresh(tx, f.tid, f.token.id, id)))
      throw appError("REFRESH_SUPERSEDED");
    const family = { id: f.token.familyId, expiresAt: f.token.expiresAt };
    return issueSession(ctx, tx, fresh, { ...meta, id, family });
  });
}

/** Refresh (FR-02): valid → xoay; rotated ≤ 10 s → SUPERSEDED; thu hồi khác → thu hồi cả chuỗi. */
export async function refresh(
  ctx: AuthCtx,
  token: string | undefined,
  meta: ClientMeta,
): Promise<Session> {
  if (!token) throw appError("INVALID_REFRESH_TOKEN");
  const f = await findRefreshToken(ctx, sha256(token));
  if (!f) throw appError("INVALID_REFRESH_TOKEN");
  const verdict = classifyRefresh(f.token, f.token.dbNow);
  if (verdict === "superseded") throw appError("REFRESH_SUPERSEDED");
  if (verdict === "reuse") {
    await withScope(ctx.db, tenantScope(f.tid), (tx) =>
      repo.revokeFamily(tx, f.tid, f.token.familyId, "reuse"),
    );
    throw appError("INVALID_REFRESH_TOKEN");
  }
  const u = f.user;
  if (verdict === "expired" || !u || !canSignIn(u, u.tenant.active)) {
    throw appError("INVALID_REFRESH_TOKEN");
  }
  return rotate(ctx, f, u, meta);
}

/** Logout (FR-03): idempotent, token lạ/đã thu hồi vẫn thành công. */
export async function logout(ctx: AuthCtx, token: string | undefined): Promise<void> {
  if (!token) return;
  const f = await findRefreshToken(ctx, sha256(token));
  if (!f || f.token.revokedAt !== null) return;
  await withScope(ctx.db, tenantScope(f.tid), (tx) =>
    repo.revokeRefresh(tx, f.tid, f.token.id, "logout"),
  );
}
