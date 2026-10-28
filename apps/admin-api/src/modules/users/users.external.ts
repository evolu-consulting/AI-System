// CR-102a · ADM-FR-75 · phần users cho user ngoài không cần khoá từng hàng (tách khỏi users.service ≤ 400 dòng):
// vô hiệu theo tập mọi user của một công ty đối tác, danh sách user của công ty.
import type { UserListQuery, UserListResponse } from "@ai/contracts";
import { type Tx, withScope } from "@ai/db";
import type { ConfigSink } from "../../lib/config/config-write";
import { toUser } from "./users.dto";
import * as repo from "./users.repo";
import type { Call } from "./users.service";

/** CR-102a · vô hiệu mọi user của công ty (gọi trong transaction của module external-orgs, sau khoá tenant → org). */
export async function deactivateOrgUsersTx(
  tx: Tx,
  ch: ConfigSink,
  t: { tenantId: string; orgId: string; by: string },
): Promise<number> {
  const ids = await repo.deactivateOrgUsers(tx, t);
  await repo.revokeUsersTokens(tx, t.tenantId, ids);
  if (ids.length > 0) ch.changed({ entity: "user", tenantId: t.tenantId });
  return ids.length;
}

/** CR-102a · danh sách user của một công ty đối tác (dùng lại list users + lọc `external_org_id`). */
export function listOrgUsers(
  c: Call,
  org: { id: string; tenantId: string },
  q: UserListQuery,
): Promise<UserListResponse> {
  const scoped = { ...q, external_org_id: org.id, kind: "external" as const };
  const f = { ...scoped, tenantId: org.tenantId, externalOrgId: org.id };
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const { rows, counts } = await repo.listUsers(tx, f);
    return {
      items: rows.map(({ total: _t, ...u }) => toUser(u)),
      total: rows[0]?.total ?? 0,
      counts,
    };
  });
}
