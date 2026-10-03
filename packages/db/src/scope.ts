// ADM-NFR-07 · ngữ cảnh RLS theo transaction (plan M1 §3.4). Mỗi hành động có DB = đúng một withScope;
// set_config(..., true) là transaction-local nên hết transaction là mất, không rò sang request khác trong pool.
import { sql } from "drizzle-orm";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Db } from "./client";

export type DbScope = { kind: "tenant"; tenantId: string } | { kind: "platform" };
export type Tx = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];

/** uuid không thuộc tenant nào: dùng khi chưa biết tenant (gọi hàm SECURITY DEFINER) → RLS không cho thấy hàng nào. */
export const NIL_TENANT_ID = "00000000-0000-0000-0000-000000000000";
export const NIL_SCOPE: DbScope = { kind: "tenant", tenantId: NIL_TENANT_ID };

/** Đổi scope trong cùng transaction (vd tenant → platform sau khi đọc role của actor). */
export async function setScope(tx: Tx, scope: DbScope): Promise<void> {
  const tid = scope.kind === "tenant" ? scope.tenantId : "";
  await tx.execute(
    sql`select set_config('app.scope', ${scope.kind}, true), set_config('app.tenant_id', ${tid}, true)`,
  );
}

/** 40P01 deadlock, 40001 serialization failure: Postgres đã rollback cả transaction nên chạy lại an toàn. */
const RETRYABLE = new Set(["40P01", "40001"]);
export const SCOPE_MAX_ATTEMPTS = 3;

export function sqlState(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Mở transaction, đặt app.scope/app.tenant_id (transaction-local) rồi chạy fn. Gặp 40P01/40001 thì chạy lại cả
 * transaction (tối đa SCOPE_MAX_ATTEMPTS lần) thay vì để thành 500 — `fn` chỉ được làm việc DB (không gửi gì ra
 * ngoài) để chạy lại không có tác dụng phụ. `config` (tuỳ chọn): mức cô lập/chế độ truy cập, vd đọc nhiều câu cần cùng
 * một snapshot → `{ isolationLevel: "repeatable read", accessMode: "read only" }`.
 */
export async function withScope<T>(
  db: Db,
  scope: DbScope,
  fn: (tx: Tx) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.db.transaction(async (tx) => {
        await setScope(tx, scope);
        return fn(tx);
      }, config);
    } catch (err) {
      const state = sqlState(err);
      if (!state || !RETRYABLE.has(state) || attempt >= SCOPE_MAX_ATTEMPTS) throw err;
    }
  }
}
