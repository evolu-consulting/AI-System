// ADM-NFR-07 · ngữ cảnh RLS theo transaction (plan M1 §3.4). Mỗi hành động có DB = đúng một withScope;
// set_config(..., true) là transaction-local nên hết transaction là mất, không rò sang request khác trong pool.
import { sql } from "drizzle-orm";
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

/** Mở transaction, đặt app.scope/app.tenant_id (transaction-local) rồi chạy fn. */
export function withScope<T>(db: Db, scope: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.db.transaction(async (tx) => {
    await setScope(tx, scope);
    return fn(tx);
  });
}
