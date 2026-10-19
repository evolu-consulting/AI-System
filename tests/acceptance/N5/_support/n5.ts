// N5-FR-01…07 · hạ tầng int N5: DB sạch (mẫu "full" của H1, có gói `contracts`) + fixture H1 (tenant acme/beta/platform,
// `padmin` platform admin, `tadmin` tenant admin) + pool `admin_api` (NOBYPASSRLS) cho công cụ chuyển. Không chứa `it(...)`.
// Dữ liệu export là GIẢ (không dữ liệu khách thật). Không sleep/poll.
import { expect } from "bun:test";
import { createDb, type Db } from "@ai/db";
import {
  insertFixture,
  OWNER_URL,
  ownerSql,
  prepareDb,
  type Sql,
  USERS,
  withCreds,
} from "../../H1/_fixtures";

export { OWNER_URL, type Sql, USERS };
export const ADMIN_API_URL = withCreds(OWNER_URL, "admin_api", "admin_api_dev_pw");
export const PACK = "contracts";
export const ROLE_GROUP = {
  owner: "contracts-owner",
  editor: "contracts-editor",
  viewer: "contracts-viewer",
} as const;

/** Mật khẩu biết trước + hash argon2id cùng tham số admin-api (nhánh "nhập hash"). */
export const KNOWN_PW = "Mgmt-Passw0rd-1";
export const argonOf = (pw: string): Promise<string> =>
  Bun.password.hash(pw, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
/** Hash kiểu mgmt-app (scrypt, hashlib) — admin-api không verify được ⇒ buộc đặt lại. */
export const SCRYPT_HASH =
  "scrypt:32768:8:1$Zm9vYmFyYmF6cXV4$4f1c2e3d5b6a79880a1b2c3d4e5f60718293a4b5c6d7e8f9";

export type OrgX = { id: string; name: string; tenant_key?: string };
export type UserX = {
  email: string;
  name: string;
  org_id: string | null;
  org_role: string | null;
  password_hash: string | null;
  locale?: "vi" | "en";
};
/** Nguồn mặc định của fixture (marker tenant = (source, org id) — security M1). */
export const SOURCE = "mgmt-test";
export const mkExport = (orgs: OrgX[], users: UserX[], source = SOURCE) => ({
  format: "mgmt-app-users/v1",
  source,
  exported_at: "2026-10-19T00:00:00Z",
  orgs,
  users,
});
export const userX = (
  email: string,
  org_id: string,
  org_role = "editor",
  hash: string | null = null,
): UserX => ({
  email,
  name: email.split("@")[0] as string,
  org_id,
  org_role,
  password_hash: hash,
});

export type CtxN5 = { sql: Sql; db: Db; padmin: string; stop: () => Promise<void> };

/** DB sạch + fixture H1; kiểm gói `contracts` đã cài (3 feature) — thiếu thì đỏ NGAY với lý do rõ. */
export async function startN5(o: { max?: number } = {}): Promise<CtxN5> {
  await prepareDb();
  const sql = ownerSql();
  await insertFixture(sql);
  const [f] = await sql<{ n: number }[]>`select count(*)::int as n from admin.features
    where key in ('contracts-read', 'contracts-write', 'contracts-admin')`;
  expect({ contracts_pack_features: f?.n }).toEqual({ contracts_pack_features: 3 });
  const db = createDb(ADMIN_API_URL, { max: o.max ?? 2 });
  return {
    sql,
    db,
    padmin: USERS.padmin.id,
    stop: async () => {
      await db.close();
      await sql.end();
    },
  };
}

/** Ảnh chụp số hàng để khẳng định "không ghi gì" / "chạy lại không nhân đôi". */
export async function snapshot(sql: Sql): Promise<Record<string, number>> {
  const [r] = await sql<Record<string, number>[]>`select
    (select count(*)::int from admin.tenants) as tenants,
    (select count(*)::int from admin.users) as users,
    (select count(*)::int from admin.groups) as groups,
    (select count(*)::int from admin.group_members) as members,
    (select count(*)::int from admin.feature_grants) as grants,
    (select count(*)::int from admin.feature_entitlements) as entitlements,
    (select count(*)::int from admin.audit_log) as audit,
    (select coalesce(max(config_version), 0)::int from admin.config_meta) as config_version`;
  return r as Record<string, number>;
}

/** Tenant tạo bởi công cụ cho org `orgId` (khớp `settings.mgmt_org_id`). */
export async function tenantOfOrg(sql: Sql, orgId: string) {
  const rows = await sql<
    { id: string; key: string; name: string }[]
  >`select id, key, name from admin.tenants
    where settings->>'mgmt_org_id' = ${orgId}`;
  return rows;
}

/** Group vai (key) của từng user theo email trong một tenant. */
export async function rolesIn(sql: Sql, tenantId: string): Promise<Record<string, string[]>> {
  const rows = await sql<{ email: string; key: string }[]>`select lower(u.email) as email, g.key
    from admin.group_members m join admin.users u on u.id = m.user_id join admin.groups g on g.id = m.group_id
    where m.tenant_id = ${tenantId} order by 1, 2`;
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const list = out[r.email] ?? [];
    list.push(r.key);
    out[r.email] = list;
  }
  return out;
}
