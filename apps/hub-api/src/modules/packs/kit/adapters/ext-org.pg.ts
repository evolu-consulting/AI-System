// CR-102a · ADM-FR-74 · adapter Postgres của `ExternalOrgResolver`: đọc `admin.users` (cột hub_ro được GRANT ở 0028) và
// `admin.external_orgs` (policy hub_ro), scope system + lọc `tenant_id` tường minh, MỘT câu mỗi lời gọi (`= any(array)`).
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { ExternalOrgResolver, ExtIdentity, UserKind } from "../application/ext-org.ports";

const MAX_IDS = 1000;
const uuidArr = (ids: readonly string[]) => `{${ids.join(",")}}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(ids: readonly string[]): string[] {
  const out = [...new Set(ids)].filter((i) => UUID_RE.test(i));
  if (out.length > MAX_IDS) throw new Error(`ExternalOrgResolver: tối đa ${MAX_IDS} id mỗi lần`);
  return out;
}

export function pgExternalOrgResolver(db: Db): ExternalOrgResolver {
  return {
    async identities(tenantId, userIds) {
      const ids = clean(userIds);
      if (ids.length === 0) return new Map();
      const rows = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{
          id: string;
          kind: UserKind;
          external_org_id: string | null;
        }>(sql`select id::text as id, kind,
            external_org_id::text as external_org_id
          from admin.users where tenant_id = ${tenantId}::uuid and id = any(${uuidArr(ids)}::uuid[])`),
      );
      return new Map<string, ExtIdentity>(
        rows.map((r) => [r.id, { kind: r.kind, extOrgId: r.external_org_id }]),
      );
    },
    async orgNames(tenantId, orgIds) {
      const ids = clean(orgIds);
      if (ids.length === 0) return new Map();
      const rows = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{
          id: string;
          name: string;
          active: boolean;
        }>(sql`select id::text as id, name, active
          from admin.external_orgs where tenant_id = ${tenantId}::uuid and id = any(${uuidArr(ids)}::uuid[])`),
      );
      return new Map(rows.map((r) => [r.id, { name: r.name, active: r.active }]));
    },
  };
}
