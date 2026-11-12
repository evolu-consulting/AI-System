// HUB-FR-75 · HUB-BR-14 · ngữ cảnh RLS bảng hội thoại hub (plan H1 §3.4), cùng cách làm `withScope` (scope.ts).
// `user` cho mọi request người dùng; `system` chỉ cho việc nền (runner, lease, quét orphan). set_config(..., true) là
// transaction-local nên không rò sang transaction khác trong pool.
import { sql } from "drizzle-orm";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import type { Db } from "./client";
import type { Tx } from "./scope";
import { runTx } from "./tx-retry";

export type HubScope = { kind: "user"; tenantId: string; userId: string } | { kind: "system" };

/** Đặt app.scope/app.tenant_id/app.user_id trong transaction hiện tại. `system` xoá tenant/user (chuỗi rỗng → NULL). */
export async function setHubScope(tx: Tx, scope: HubScope): Promise<void> {
  const tid = scope.kind === "user" ? scope.tenantId : "";
  const uid = scope.kind === "user" ? scope.userId : "";
  await tx.execute(
    sql`select set_config('app.scope', ${scope.kind}, true), set_config('app.tenant_id', ${tid}, true),
      set_config('app.user_id', ${uid}, true)`,
  );
}

/**
 * Mở transaction, đặt scope hub rồi chạy fn. 40P01/40001/mất kết nối trước COMMIT (tx-retry.ts) → chạy lại cả transaction (tối đa SCOPE_MAX_ATTEMPTS),
 * nên `fn` chỉ được làm việc DB (không gửi gì ra ngoài) để chạy lại không có tác dụng phụ.
 */
export async function withHubScope<T>(
  db: Db,
  scope: HubScope,
  fn: (tx: Tx) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  return runTx(
    db,
    async (tx) => {
      await setHubScope(tx, scope);
      return fn(tx);
    },
    config,
  );
}

/** Scope `system` cần đọc/ghi thay một công ty (hàm DEFINER, RLS theo `app.tenant_id`): đặt lại tenant trong tx hiện tại, giữ `app.scope`. */
export async function setHubTenantInTx(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
}
