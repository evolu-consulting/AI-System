// dlc-dify · nghiệp vụ `POST /internal/tokens`: tra user còn đăng nhập được (qua service của auth, không chạm repo module khác).
// User khoá / tenant tắt / không có ⇒ `null` (route trả 404, không lộ lý do).
import { type Db, withScope } from "@ai/db";
import { canSignIn } from "../auth/auth.rules";
import { findUserById } from "../auth/auth.service";

export async function findSignInUser(db: Db, tenantId: string, userId: string) {
  const u = await withScope(db, { kind: "tenant", tenantId }, (tx) =>
    findUserById(tx, tenantId, userId),
  );
  return u && canSignIn(u, u.tenant.active) ? u : null;
}
