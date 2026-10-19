// PK-FR-03 · PK-FR-08 · PK-FR-09 · D-06 · N1 plan §4, §8: `PackUow`/`PackSystemUow` trên `withPackScope` (pool `hub_api`, mỗi
// tx một câu `set_config('role'…)` + tenant/user). Repo của gói dựng trong tx bằng `repos(tx, tenantId)` — `tenantId` từ
// token/vòng nền, repo vẫn lọc `tenant_id` tường minh ngoài RLS. Bộ khung ghép thêm `outbox` (`<k>.index_outbox`, cùng tx) cho
// MỌI gói — chỉ dựng closure, 0 câu tới khi `enqueue`. Khoá gói/tenant sai ⇒ `PackScopeError` trước khi mở tx.
import type { Db, Tx } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import type { KitTxRepos } from "../application/index-outbox";
import type { NotifyTxRepos } from "../application/notify";
import type { PackSystemUow, PackUow } from "../application/ports";
import { indexOutboxFor } from "./index-outbox.repo";
import { notifierFor } from "./notify.repo";

export type PackReposFactory<R> = (tx: Tx, tenantId: string) => R;

/** Repo trong tx mà gói nhận: của gói (`R`) + bộ khung (`outbox` chỉ mục, `notify` thông báo N3). */
export type PackTxRepos<R> = R & KitTxRepos & NotifyTxRepos;

export function createPackUow<R>(
  db: Db,
  packKey: string,
  repos: PackReposFactory<R>,
): PackUow<PackTxRepos<R>> & PackSystemUow<PackTxRepos<R>> {
  const outbox = indexOutboxFor(packKey);
  const notify = notifierFor(packKey);
  const all = (tx: Tx, tenantId: string): PackTxRepos<R> => ({
    ...repos(tx, tenantId),
    outbox: outbox(tx, tenantId),
    notify: notify(tx),
  });
  return {
    tenant: (who, fn) =>
      withPackScope(db, { packKey, tenantId: who.tenantId, userId: who.userId }, (tx) =>
        fn(all(tx, who.tenantId)),
      ),
    system: (tenantId, fn) =>
      withPackScope(db, { packKey, tenantId, userId: null }, (tx) => fn(all(tx, tenantId))),
  };
}

/** Object riêng CHỈ có `tenant` (route/use case HTTP): ép kiểu cũng không tới `system`. */
export function packTenantOnly<R>(u: PackUow<R>): PackUow<R> {
  return { tenant: u.tenant };
}
