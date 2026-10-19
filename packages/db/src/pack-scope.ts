// PK-FR-03 · PK-FR-09 · D-06 · N1 plan §4: transaction của module gói trên pool `hub_api` sẵn có (không pool mới). Câu đầu
// DUY NHẤT đặt role gói `<k>_rw` + `app.tenant_id` + `app.user_id` (transaction-local ⇒ hết tx role trở lại `hub_api`, không rò
// sang request sau). Kiểm khoá gói (`PackKeySchema`) và tenant (uuid) TRƯỚC khi mở tx. Thử lại 40P01/40001 như `withHubScope`.
import { PackKeySchema } from "@ai/contracts";
import { sql } from "drizzle-orm";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import type { Db } from "./client";
import { SCOPE_MAX_ATTEMPTS, sqlState, type Tx } from "./scope";

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
const RETRYABLE = new Set(["40P01", "40001"]);

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
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('role', ${role}, true)`);
        return fn(tx);
      });
    } catch (err) {
      const state = sqlState(err);
      if (!state || !RETRYABLE.has(state) || attempt >= SCOPE_MAX_ATTEMPTS) throw err;
    }
  }
}

/**
 * Mở tx, một câu `set_config('role'…)` + tenant/user, rồi chạy `fn`. `fn` chỉ làm việc DB (chạy lại khi 40P01/40001 không
 * có tác dụng phụ). Mọi bảng gói có RLS FORCE theo `app.tenant_id` (`packs.secure_table`).
 */
export async function withPackScope<T>(
  db: Db,
  scope: PackScope,
  fn: (tx: Tx) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  const { role, tid, uid } = checkScope(scope);
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.db.transaction(async (tx) => {
        // HD78 · Luật 4c: tắt JIT trong tx gói (cùng câu, không thêm câu). Policy RESTRICTIVE của M1 (subplan EXISTS) đẩy ước lượng
        // chi phí câu danh sách vượt `jit_above_cost` ⇒ Postgres biên dịch JIT ~70 ms cho câu chạy ~30 ms (đo: GET /payments
        // 125,6 ms, JIT 70,7 ms). Câu gói là OLTP ngắn ⇒ JIT chỉ tốn.
        await tx.execute(
          sql`select set_config('role', ${role}, true), set_config('app.tenant_id', ${tid}, true),
            set_config('app.user_id', ${uid}, true), set_config('jit', 'off', true)`,
        );
        return fn(tx);
      }, config);
    } catch (err) {
      const state = sqlState(err);
      if (!state || !RETRYABLE.has(state) || attempt >= SCOPE_MAX_ATTEMPTS) throw err;
    }
  }
}
