// ADM-FR-01, ADM-FR-04, ADM-FR-60, ADM-NFR-06 · dữ liệu fixture M1 (test-plan §3). Dùng chung cho test int (bun)
// và e2e/support (prepare-db). Chỉ phụ thuộc `postgres`; không import bun:test để Playwright (Node) import được.
import type postgres from "postgres";

type Sql = postgres.Sql;

export const PW = "Test-Passw0rd-1";
export const SEED_PW = "Seed-Admin-Pw-01";
export const TEMP_PW = "Temp-Passw0rd-1";

const uuid = (n: number): string => `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;

export const TENANT_ID = { acme: uuid(1), globex: uuid(2), zeta: uuid(3), bulk: uuid(4) } as const;
export const USER_ID = {
  binh: uuid(11),
  chi: uuid(12),
  an: uuid(13),
  lan: uuid(14),
  dung: uuid(15),
  em: uuid(16),
  thu: uuid(17),
  hoa: uuid(21),
  globexAn: uuid(22),
  khang: uuid(23),
  zoe: uuid(31),
  zed: uuid(32),
  admin2: uuid(41),
} as const;
/** uuid hợp lệ nhưng không có trong DB. */
export const UNKNOWN_ID = uuid(999);
export const LOGIN_AT = "2026-09-30T08:00:00.000Z";

type Role = "platform_admin" | "tenant_admin" | "member";
export type UserRow = {
  id: string;
  tenant_id: string;
  username: string;
  email: string | null;
  password_hash: string;
  display_name: string;
  role: Role;
  locale: "vi" | "en";
  active: boolean;
  locked_by_tenant: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
};

export type Hashes = { pw: string; temp: string };

const T = TENANT_ID;
const U = USER_ID;

function user(
  id: string,
  tenant_id: string,
  username: string,
  display_name: string,
  role: Role,
  over: Partial<UserRow> & { hash: string },
): UserRow {
  const { hash, ...rest } = over;
  return {
    id,
    tenant_id,
    username,
    email: null,
    password_hash: hash,
    display_name,
    role,
    locale: "vi",
    active: true,
    locked_by_tenant: false,
    must_change_password: false,
    last_login_at: null,
    ...rest,
  };
}

/** 13 user của fixture (không gồm `admin` do runSeed tạo). `platformId` = id tenant platform. */
export function fixtureUsers(platformId: string, h: Hashes): UserRow[] {
  const pw = h.pw;
  return [
    user(U.admin2, platformId, "admin2", "Second Admin", "platform_admin", { hash: pw }),
    user(U.binh, T.acme, "binh", "Binh Le", "tenant_admin", {
      hash: pw,
      email: "binh@acme.test",
      last_login_at: LOGIN_AT,
    }),
    user(U.chi, T.acme, "chi", "Chi Pham", "tenant_admin", {
      hash: pw,
      email: "chi@acme.test",
      last_login_at: LOGIN_AT,
    }),
    user(U.an, T.acme, "an", "An Nguyen", "member", { hash: pw }),
    user(U.lan, T.acme, "lan", "Lan Tran", "member", { hash: pw, email: "lan@acme.test" }),
    user(U.dung, T.acme, "dung", "Dung Vo", "member", {
      hash: h.temp,
      must_change_password: true,
    }),
    user(U.em, T.acme, "em", "Em Do", "member", { hash: pw, active: false }),
    user(U.thu, T.acme, "thu", "Thu Ha", "member", { hash: pw }),
    user(U.hoa, T.globex, "hoa", "Hoa Dang", "tenant_admin", {
      hash: pw,
      email: "hoa@globex.test",
    }),
    user(U.globexAn, T.globex, "an", "An Globex", "member", { hash: pw }),
    user(U.khang, T.globex, "khang", "Khang Ly", "member", { hash: pw }),
    user(U.zoe, T.zeta, "zoe", "Zoe Zeta", "tenant_admin", {
      hash: pw,
      email: "zoe@zeta.test",
      locked_by_tenant: true,
    }),
    user(U.zed, T.zeta, "zed", "Zed Zeta", "member", { hash: pw, locked_by_tenant: true }),
  ];
}

const USER_COLS = [
  "id",
  "tenant_id",
  "username",
  "email",
  "password_hash",
  "display_name",
  "role",
  "locale",
  "active",
  "locked_by_tenant",
  "must_change_password",
  "last_login_at",
] as const;

export async function insertUsers(sql: Sql, rows: UserRow[]): Promise<void> {
  await sql`insert into admin.users ${sql(rows, ...USER_COLS)}`;
}

/** Chèn acme/globex/zeta + 13 user vào DB đã migrate + seed (tenant platform có sẵn). Dùng owner. */
export async function insertFixture(sql: Sql, h: Hashes): Promise<void> {
  const [platform] = await sql<
    { id: string }[]
  >`select id from admin.tenants where key = 'platform'`;
  if (!platform) throw new Error("insertFixture: chưa có tenant platform (chạy runSeed trước)");
  await sql`insert into admin.tenants (id, key, name, active, max_concurrent_sub) values
    (${T.acme}, 'acme', 'Acme Corp', true, 5),
    (${T.globex}, 'globex', 'Globex', true, null),
    (${T.zeta}, 'zeta', 'Zeta Ltd', false, null)`;
  await insertUsers(sql, fixtureUsers(platform.id, h));
}

/** Tenant `bulk` + `n` member (e2e phân trang); chèn bằng một hash. */
export async function insertBulk(sql: Sql, hash: string, n = 55): Promise<void> {
  await sql`insert into admin.tenants (id, key, name) values (${T.bulk}, 'bulk', 'Bulk Co')`;
  const rows = Array.from({ length: n }, (_, i) =>
    user(uuid(1000 + i), T.bulk, `bulk${String(i).padStart(3, "0")}`, `Bulk ${i}`, "member", {
      hash,
    }),
  );
  await insertUsers(sql, rows);
}

export async function truncateAll(sql: Sql): Promise<void> {
  await sql`truncate admin.refresh_tokens, admin.users, admin.tenants cascade`;
}

/** Argon2id đúng tham số của spec §6, độc lập với code sản phẩm. */
export function hashPw(pw: string): Promise<string> {
  return Bun.password.hash(pw, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
}

export async function makeHashes(): Promise<Hashes> {
  const [pw, temp] = await Promise.all([hashPw(PW), hashPw(TEMP_PW)]);
  return { pw, temp };
}
