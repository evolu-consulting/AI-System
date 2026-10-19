// I1 · `IdentityPort`: user/org qua N5 (`runIdentityImport`, gồm hash scrypt cũ — N5b) trên pool `admin_api` (NOBYPASSRLS, scope
// platform); quản lý trực tiếp `manager_email` do N5 (M1b) ghi; tra tenant theo marker `(mgmt_source, mgmt_org_id)` và user theo email.
import { type Db, type Tx, withScope } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { runIdentityImport } from "../../identity-import/identity-import.run";
import type { IdentityPort } from "../application/ports";

const PLATFORM = { kind: "platform" } as const;
const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];

export function createIdentityAdapter(db: Db, actorId: string, batch?: number): IdentityPort {
  return {
    run: (file, apply) => runIdentityImport(db, file, { actorId, apply, batch }),
    tenants: (source) =>
      withScope(db, PLATFORM, async (tx) =>
        (
          await run<{ id: string; org_id: string }>(
            tx,
            sql`select id, settings->>'mgmt_org_id' as org_id from admin.tenants
          where settings->>'mgmt_source' = ${source} and settings ? 'mgmt_org_id'`,
          )
        ).map((r) => ({ id: r.id, orgId: r.org_id })),
      ),
    users: (tenantIds) =>
      withScope(db, PLATFORM, async (tx) =>
        (
          await run<{ id: string; tenant_id: string; email: string }>(
            tx,
            sql`select id, tenant_id, lower(email) as email
          from admin.users where tenant_id = any(array(select x::uuid from jsonb_array_elements_text(${JSON.stringify(tenantIds)}::jsonb) as x))
            and email is not null`,
          )
        ).map((r) => ({ id: r.id, tenantId: r.tenant_id, email: r.email })),
      ),
  };
}
