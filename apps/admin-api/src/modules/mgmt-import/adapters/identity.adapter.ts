// I1 · `IdentityPort`: user/org qua N5 (`runIdentityImport`, gồm hash scrypt cũ — N5b) trên pool `admin_api` (NOBYPASSRLS, scope
// platform); quản lý trực tiếp `manager_email` do N5 (M1b) ghi; tra tenant theo marker `(mgmt_source, mgmt_org_id)` và user theo email.
import { type Db, type Tx, withScope } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { tenantKeyFor } from "../../identity-import/domain/import.rules";
import { runIdentityImport } from "../../identity-import/identity-import.run";
import type { IdentityPort } from "../application/ports";
import type { UsersExport } from "../domain/map-identity.rules";

const PLATFORM = { kind: "platform" } as const;

/** Hai org cùng tên ⇒ cùng khoá tenant (slug) ⇒ N5 báo DUPLICATE_KEY và bỏ org sau (gặp thật trên bản sao seed: 2 org
 *  `Công ty An Nam`). Org đầu (theo id) giữ slug; org sau nhận `<slug ≤23>-<8 hex id>` — tất định, chạy lại cùng khoá. */
export function withUniqueKeys(file: UsersExport): UsersExport {
  const used = new Set<string>();
  const orgs = [...file.orgs]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((o) => {
      const key = tenantKeyFor({ id: o.id, name: o.name, tenantKey: null });
      if (!used.has(key)) {
        used.add(key);
        return o;
      }
      const hex = new Bun.CryptoHasher("sha256").update(o.id).digest("hex").slice(0, 8);
      const alt = `${key.slice(0, 23).replace(/-+$/, "")}-${hex}`;
      used.add(alt);
      return { ...o, tenant_key: alt };
    });
  return { ...file, orgs };
}
const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];

const tenantsOf =
  (db: Db): IdentityPort["tenants"] =>
  (source) =>
    withScope(db, PLATFORM, async (tx) =>
      (
        await run<{ id: string; org_id: string; active: boolean; pack_revoked: boolean }>(
          tx,
          // review A-4: cùng luật với N5 (`import.repo.ts::findTenants`) — tenant đã tắt hoặc đã thu hồi gói `contracts-*` mà
          // N5 bỏ qua thì importer cũng bỏ (không hoàn tác việc admin thu hồi — L2).
          sql`select t.id, t.settings->>'mgmt_org_id' as org_id, t.active,
              exists (select 1 from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
                where e.tenant_id = t.id and e.revoked_at is not null and f.key like 'contracts-%') as pack_revoked
            from admin.tenants t
            where t.settings->>'mgmt_source' = ${source} and t.settings ? 'mgmt_org_id'`,
        )
      ).map((r) => ({
        id: r.id,
        orgId: r.org_id,
        active: r.active,
        packRevoked: r.pack_revoked,
      })),
    );

export function createIdentityAdapter(db: Db, actorId: string, batch?: number): IdentityPort {
  return {
    run: (file, apply) =>
      runIdentityImport(db, withUniqueKeys(file as UsersExport), { actorId, apply, batch }),
    tenants: tenantsOf(db),
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
    tenantByKey: (key) =>
      withScope(db, PLATFORM, async (tx) => {
        const [r] = await run<{
          id: string;
          active: boolean;
          src: string | null;
          org: string | null;
        }>(
          tx,
          sql`select id, active, settings->>'mgmt_source' as src, settings->>'mgmt_org_id' as org
            from admin.tenants where key = ${key}`,
        );
        return r ? { id: r.id, active: r.active, source: r.src, orgId: r.org } : null;
      }),
  };
}
