// PK-FR-03 · PK-FR-09 · D-06 · N1 plan §4: `PackUow`/`PackSystemUow` trên `withPackScope` (pool `hub_api`, mỗi tx một câu
// `set_config('role'…)` + tenant/user). Repo của gói dựng trong tx bằng `repos(tx, tenantId)` — `tenantId` từ token/vòng nền,
// repo vẫn lọc `tenant_id` tường minh ngoài RLS. Khoá gói/tenant sai ⇒ `PackScopeError` trước khi mở tx.
import type { Db, Tx } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import type { PackSystemUow, PackUow } from "../application/ports";

export type PackReposFactory<R> = (tx: Tx, tenantId: string) => R;

export function createPackUow<R>(
  db: Db,
  packKey: string,
  repos: PackReposFactory<R>,
): PackUow<R> & PackSystemUow<R> {
  return {
    tenant: (who, fn) =>
      withPackScope(db, { packKey, tenantId: who.tenantId, userId: who.userId }, (tx) =>
        fn(repos(tx, who.tenantId)),
      ),
    system: (tenantId, fn) =>
      withPackScope(db, { packKey, tenantId, userId: null }, (tx) => fn(repos(tx, tenantId))),
  };
}

/** Object riêng CHỈ có `tenant` (route/use case HTTP): ép kiểu cũng không tới `system`. */
export function packTenantOnly<R>(u: PackUow<R>): PackUow<R> {
  return { tenant: u.tenant };
}
