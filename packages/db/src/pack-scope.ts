// PK-FR-03 · PK-FR-09 · D-06 · N1 plan §4: transaction của module gói trên pool `hub_api` sẵn có (không pool mới). Câu đầu
// DUY NHẤT đặt role gói `<k>_rw` + `app.tenant_id` + `app.user_id` + `app.user_kind` (CR-102a) (transaction-local ⇒ hết tx role trở lại `hub_api`, không rò
// sang request sau). Kiểm khoá gói (`PackKeySchema`) và tenant (uuid) TRƯỚC khi mở tx. Thử lại 40P01/40001 như `withHubScope`.
import { PackKeySchema } from "@ai/contracts/packs";
import { sql } from "drizzle-orm";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import type { Db } from "./client";
import type { Tx } from "./scope";
import { runTx } from "./tx-retry";

/** `userId: null` = việc nền (PackSystemUow) — chỉ đặt tenant. */
export type PackScope = { packKey: string; tenantId: string; userId: string | null };
export type PackScopeErrorCode = "TENANT_INVALID" | "PACK_KEY_INVALID" | "USER_INVALID";

/** Lỗi đầu vào phạm vi gói (ném trước khi mở tx; `message` = mã). */
export class PackScopeError extends Error {
  constructor(readonly code: PackScopeErrorCode) {
    super(code);
    this.name = "PackScopeError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Role DB của gói (`packs.install`): `<k>_rw`. Khoá sai dạng / bị cấm ⇒ `PACK_KEY_INVALID`. */
export function packRole(packKey: string): string {
  if (!PackKeySchema.safeParse(packKey).success) throw new PackScopeError("PACK_KEY_INVALID");
  return `${packKey}_rw`;
}

function checkScope(scope: PackScope): { role: string; tid: string; uid: string } {
  const role = packRole(scope.packKey);
  if (typeof scope.tenantId !== "string" || !UUID.test(scope.tenantId))
    throw new PackScopeError("TENANT_INVALID");
  if (scope.userId !== null && (typeof scope.userId !== "string" || !UUID.test(scope.userId)))
    throw new PackScopeError("USER_INVALID");
  return { role, tid: scope.tenantId, uid: scope.userId ?? "" };
}

/**
 * HD4 · N1 D-12 · tx của role quét chéo tenant `<k>_job` (NOBYPASSRLS, policy riêng chỉ cho cột lịch): một câu đặt role,
 * KHÔNG đặt `app.tenant_id` (việc theo tenant phải mở `withPackScope` riêng). Chỉ đọc; thử lại 40P01/40001.
 */
export async function withPackJobScope<T>(
  db: Db,
  packKey: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!PackKeySchema.safeParse(packKey).success) throw new PackScopeError("PACK_KEY_INVALID");
  const role = `${packKey}_job`;
  return runTx(db, async (tx) => {
    await tx.execute(sql`select set_config('role', ${role}, true)`);
    return fn(tx);
  });
}

/**
 * Mở tx, một câu `set_config('role'…)` + tenant/user, rồi chạy `fn`. `fn` chỉ làm việc DB (chạy lại khi 40P01/40001/mất kết nối trước COMMIT không
 * có tác dụng phụ). Mọi bảng gói có RLS FORCE theo `app.tenant_id` (`packs.secure_table`).
 */
export async function withPackScope<T>(
  db: Db,
  scope: PackScope,
  fn: (tx: Tx) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  const { role, tid, uid } = checkScope(scope);
  return runTx(
    db,
    async (tx) => {
      // HD78 · Luật 4c: tắt JIT trong tx gói (cùng câu, không thêm câu). Policy RESTRICTIVE của M1 (subplan EXISTS) đẩy ước lượng
      // chi phí câu danh sách vượt `jit_above_cost` ⇒ Postgres biên dịch JIT ~70 ms cho câu chạy ~30 ms (đo: GET /payments
      // 125,6 ms, JIT 70,7 ms). Câu gói là OLTP ngắn ⇒ JIT chỉ tốn.
      // CR-102a · com-c2: `app.user_kind` lấy từ DB (sự thật, không tin người gọi) trong CÙNG câu; việc nền / user lạ ⇒ ''.
      // RLS phòng thủ của gói (vd contracts 0067) chặn 'external'. CR-102 · com-c3: `app.ext_org_id` (kit 0006
      // `packs.scope_ext_org`: ''/'internal'/uuid công ty/'denied') cũng trong câu này. Cả hai qua hàm SECURITY DEFINER (kit
      // 0008 `packs.scope_user_kind`) — không đọc thẳng `admin.users` ⇒ pool riêng của gói (R1 `knowledge_api`, không USAGE
      // `admin`) chạy được. `set_config('role'…)` ĐỨNG ĐẦU câu (đếm câu HD1/N1 neo vào đó): quyền EXECUTE kiểm lúc khởi tạo
      // câu bằng role đăng nhập (hub_api / knowledge_api), thân hàm chạy bằng chủ hàm ⇒ role gói không cần quyền gì thêm.
      await tx.execute(
        sql`select set_config('role', ${role}, true), set_config('app.tenant_id', ${tid}, true),
            set_config('app.user_id', ${uid}, true),
            set_config('app.user_kind', packs.scope_user_kind(${uid}), true),
            set_config('app.ext_org_id', packs.scope_ext_org(${tid}, ${uid}), true),
            set_config('jit', 'off', true)`,
      );
      return fn(tx);
    },
    config,
  );
}

type PrevScope = { role: string; tid: string; uid: string; kind: string; ext: string };

/** Ràng buộc DEFERRABLE INITIALLY DEFERRED của schema gói: chạy ngay (IMMEDIATE) rồi đặt lại DEFERRED. Không có ⇒ không làm gì. */
async function deferredPackChecksNow(tx: Tx, pack: string): Promise<void> {
  const [r] = await tx.execute<{ names: string | null }>(sql`select string_agg(
      quote_ident(n.nspname) || '.' || quote_ident(c.conname), ', ') as names
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = ${pack} and c.condeferrable and c.condeferred`);
  if (!r?.names) return;
  await tx.execute(sql.raw(`set constraints ${r.names} immediate`));
  await tx.execute(sql.raw(`set constraints ${r.names} deferred`));
}

/** CR-122 A2b: chạy `fn` dưới role gói + tenant NGAY TRONG tx đang mở (tx engine), xong (kể cả `fn` ném) trả role/app.* như cũ.
 *  Dùng cho OutcomeHandler của gói. `pack` sai ⇒ PACK_KEY_INVALID; `tenantId` sai ⇒ TENANT_INVALID, trước khi đổi gì. */
export async function withPackRoleInTx<T>(
  tx: Tx,
  pack: string,
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const role = packRole(pack);
  if (typeof tenantId !== "string" || !UUID.test(tenantId))
    throw new PackScopeError("TENANT_INVALID");
  const [prev] = await tx.execute<PrevScope>(sql`select current_user::text as role,
      coalesce(current_setting('app.tenant_id', true), '') as tid, coalesce(current_setting('app.user_id', true), '') as uid,
      coalesce(current_setting('app.user_kind', true), '') as kind, coalesce(current_setting('app.ext_org_id', true), '') as ext`);
  if (!prev) throw new Error("withPackRoleInTx: không đọc được scope hiện tại");
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
    // CR-122 · trigger ràng buộc DEFERRED của gói (vd contracts v2d_sc_*: HĐ bán sang hiệu lực) mặc định chạy lúc COMMIT — khi đó
    // role đã trả về `hub_api` (không USAGE schema gói) ⇒ "permission denied for schema contracts" ⇒ cả tx engine rollback,
    // stage Kết thúc kẹt `queued`. Chạy ngay các kiểm tra đang hoãn CỦA GÓI dưới role gói, rồi trả chúng về hoãn — ràng buộc
    // hoãn của hub (vd rooms 0011/0013) giữ nguyên (soát Opus).
    await deferredPackChecksNow(tx, pack);
  } catch (e) {
    await restore().catch(() => undefined); // tx đã hỏng ⇒ sẽ rollback, giữ lỗi gốc
    throw e;
  }
  await restore();
  return out;
}
