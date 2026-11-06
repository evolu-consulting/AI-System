// CR-122 · A2b · chạy `fn` dưới role gói `<k>_rw` + tenant NGAY TRONG tx đang mở (tx engine / tx hub), không mở tx mới. Dùng cho cổng app
// mà engine gọi trong tx settle của nó (OutcomeHandler: Community, Contracts) — cần RLS của gói áp, cùng commit/rollback với lượt chạy.
// Bộ `set_config` lấy từ `withPackScope` (role + app.tenant_id/user_id/user_kind/ext_org_id; user rỗng ⇒ việc hệ thống). Xong (kể cả `fn`
// ném) trả role và `app.*` về như cũ. Tx đã hỏng (lỗi SQL không bọc savepoint) ⇒ không trả được: giữ lỗi gốc, tx sẽ rollback.
import type { Tx } from "@ai/db";
import { packRole } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Scope = { role: string; tid: string; uid: string; kind: string; ext: string };

async function currentScope(tx: Tx): Promise<Scope> {
  const [s] = await tx.execute<Scope>(sql`select current_user::text as role,
      coalesce(current_setting('app.tenant_id', true), '') as tid, coalesce(current_setting('app.user_id', true), '') as uid,
      coalesce(current_setting('app.user_kind', true), '') as kind, coalesce(current_setting('app.ext_org_id', true), '') as ext`);
  if (!s) throw new Error("withPackRoleInTx: không đọc được scope hiện tại");
  return s;
}

/** `pack` sai dạng ⇒ `PackScopeError("PACK_KEY_INVALID")`; `tenantId` không phải uuid ⇒ lỗi trước khi đổi gì. */
export async function withPackRoleInTx<T>(
  tx: Tx,
  pack: string,
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const role = packRole(pack);
  if (!UUID.test(tenantId)) throw new Error("withPackRoleInTx: tenantId không hợp lệ");
  const prev = await currentScope(tx);
  await tx.execute(sql`select set_config('role', ${role}, true), set_config('app.tenant_id', ${tenantId}, true),
      set_config('app.user_id', '', true), set_config('app.user_kind', packs.scope_user_kind(''), true),
      set_config('app.ext_org_id', packs.scope_ext_org(${tenantId}, ''), true)`);
  const restore = () =>
    tx.execute(sql`select set_config('role', ${prev.role}, true), set_config('app.tenant_id', ${prev.tid}, true),
      set_config('app.user_id', ${prev.uid}, true), set_config('app.user_kind', ${prev.kind}, true),
      set_config('app.ext_org_id', ${prev.ext}, true)`);
  let out: T;
  try {
    out = await fn();
  } catch (e) {
    // `fn` lỗi ⇒ giữ lỗi gốc; trả scope nếu tx còn chạy được (tx đã hỏng thì sẽ rollback, không trả được)
    await restore().catch(() => undefined);
    throw e;
  }
  await restore();
  return out;
}
