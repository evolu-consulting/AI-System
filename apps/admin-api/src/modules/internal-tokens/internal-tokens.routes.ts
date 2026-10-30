// dlc-dify · `POST /internal/tokens` — CHỈ Hub gọi (Bearer = `HUB_INTERNAL_TOKEN`, so hằng thời gian): cấp access token
// ngắn hạn (TTL như đăng nhập, `sid` null) cho một user còn đăng nhập được. Hub dùng nó khi chạy hook Dify / gọi KH thay user
// trong run dài (token gốc của request 15 phút đã hết). Không cấp refresh token, không tạo phiên, không đọc mật khẩu.
// User khoá / tenant tắt / không có ⇒ 404 (không lộ lý do). Vắng `HUB_INTERNAL_TOKEN` ⇒ route không mount.
import { createHash, timingSafeEqual } from "node:crypto";
import { type Db, withScope } from "@ai/db";
import { Hono } from "hono";
import { z } from "zod";
import { type JwtKeys, signAccessToken } from "../../lib/jwt";
import * as repo from "../auth/auth.repo";
import { canSignIn } from "../auth/auth.rules";

const BodySchema = z.strictObject({ tenant_id: z.uuid(), user_id: z.uuid() });
const ACCESS_TTL_S = 900;

const digest = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (given: string, want: string) => timingSafeEqual(digest(given), digest(want));

export function internalTokensRoutes(ctx: { db: Db; keys: JwtKeys; token: string }) {
  const r = new Hono();
  r.post("/tokens", async (c) => {
    const auth = c.req.header("Authorization") ?? "";
    const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!given || !sameToken(given, ctx.token)) return c.body(null, 401);
    const parsed = BodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ code: "VALIDATION_ERROR" }, 400);
    const { tenant_id: tid, user_id: uid } = parsed.data;
    const u = await withScope(ctx.db, { kind: "tenant", tenantId: tid }, (tx) =>
      repo.findUserById(tx, tid, uid),
    );
    if (!u || !canSignIn(u, u.tenant.active)) return c.json({ code: "NOT_FOUND" }, 404);
    const token = await signAccessToken(ctx.keys, {
      sub: u.id,
      tid: u.tenantId,
      role: u.role,
      sid: null,
      kind: u.kind,
      extOrgId: u.externalOrgId,
    });
    return c.json({ access_token: token, token_type: "Bearer", expires_in: ACCESS_TTL_S });
  });
  return r;
}
