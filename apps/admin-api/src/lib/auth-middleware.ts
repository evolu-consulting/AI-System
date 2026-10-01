// ADM-FR-01, ADM-BR-05, ADM-BR-09, ADM-NFR-07 · xác thực Bearer + scope RLS (plan M1 §5 "Middleware").
// Đọc lại user từ DB mỗi request: khoá/hạ role có hiệu lực ngay ở Admin. Scope `platform` chỉ khi role trong DB
// là platform_admin VÀ thuộc tenant `platform` — claim `role` trong token không bao giờ được tin.
import type { Role } from "@ai/contracts";
import { type Db, type DbScope, tenants, users, withScope } from "@ai/db";
import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { canSignIn } from "../modules/auth/auth.rules";
import { appError } from "./errors";
import { type JwtKeys, verifyAccessToken } from "./jwt";

export type Actor = {
  userId: string;
  tenantId: string;
  tenantKey: string;
  role: Role;
  /** family_id của phiên (claim `sid`), null nếu token không có. */
  sid: string | null;
};
export type AppVars = { Variables: { requestId: string; actor: Actor; scope: DbScope } };
export type AuthDeps = { db: Db; keys: JwtKeys };

const PLATFORM_KEY = "platform";
const BEARER_RE = /^Bearer ([A-Za-z0-9._-]+)$/;

export function scopeOf(a: Actor): DbScope {
  return a.role === "platform_admin" && a.tenantKey === PLATFORM_KEY
    ? { kind: "platform" }
    : { kind: "tenant", tenantId: a.tenantId };
}

async function loadActor(db: Db, tid: string, userId: string) {
  return withScope(db, { kind: "tenant", tenantId: tid }, async (tx) => {
    const [row] = await tx
      .select({
        role: users.role,
        active: users.active,
        lockedByTenant: users.lockedByTenant,
        tenantKey: tenants.key,
        tenantActive: tenants.active,
      })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(eq(users.tenantId, tid), eq(users.id, userId)))
      .limit(1);
    return row ?? null;
  });
}

/** Token hợp lệ + user còn đăng nhập được → Actor; ngược lại 401 UNAUTHORIZED. */
export async function authenticate(c: Context, d: AuthDeps): Promise<Actor> {
  const m = BEARER_RE.exec(c.req.header("authorization") ?? "");
  const claims = m?.[1] ? await verifyAccessToken(d.keys, m[1]) : null;
  if (!claims) throw appError("UNAUTHORIZED");
  const row = await loadActor(d.db, claims.tid, claims.sub);
  if (!row || !canSignIn(row, row.tenantActive)) throw appError("UNAUTHORIZED");
  return {
    userId: claims.sub,
    tenantId: claims.tid,
    tenantKey: row.tenantKey,
    role: row.role,
    sid: claims.sid,
  };
}

export function requireAuth(d: AuthDeps): MiddlewareHandler<AppVars> {
  return async (c, next) => {
    const actor = await authenticate(c, d);
    c.set("actor", actor);
    c.set("scope", scopeOf(actor));
    await next();
  };
}

/** Kiểm role (đọc từ DB) trước khi tra thực thể; sai → 403 FORBIDDEN. */
export function requireRole(...roles: Role[]): MiddlewareHandler<AppVars> {
  return async (c, next) => {
    if (!roles.includes(c.get("actor").role)) throw appError("FORBIDDEN");
    await next();
  };
}
