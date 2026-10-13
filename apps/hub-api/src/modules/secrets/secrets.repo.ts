// HUB-FR-68 · HUB-FR-69 · HUB-BR-15 · spec H4b-1 §3–§4 · plan D6–D9, D14, §3 Query & index · câu SQL `hub.secrets`.
// Transaction + scope do service/`withConfigWrite` mở. BẪY: `hub_rw` không SELECT được `ciphertext`/`iv` ⇒ mọi select liệt kê
// cột (không `select *`/`returning *`); bản mã CHỈ đọc qua `hub.secret_material(id, kind, tenant)`. Giá trị không bao giờ
// vào SQL — chỉ bản mã bytea. `admin.tenants`/`admin.users` đọc qua hub_ro (USING true) để dựng `tenant`/`updated_by`.
import type { SecretUsedBy } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { SealedSecret } from "./secrets.crypto";
import type { HubSecretKind, SecretCursor } from "./secrets.rules";

const iso = (v: Date | string): string => new Date(v).toISOString();
const uuidArr = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;
const textArr = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::text[]`;
const bytes = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength);

export type SecretViewRow = {
  id: string;
  kind: HubSecretKind;
  tenantId: string | null;
  tenantKey: string | null;
  tenantName: string | null;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};
type RawView = Omit<SecretViewRow, "createdAt" | "updatedAt"> & {
  createdAt: Date | string;
  updatedAt: Date | string;
};

/** Lọc thêm khi đọc theo id: route tenant = `{kind: source_credential, tenantId}`; Studio = `{}` (mọi hàng). */
export type SecretFilter = { kind?: HubSecretKind; tenantId?: string };

const VIEW = sql`select s.id, s.kind, s.tenant_id as "tenantId", t.key as "tenantKey", t.name as "tenantName", s.name,
  s.version, s.created_at as "createdAt", s.updated_at as "updatedAt", u.username as "updatedBy"
  from hub.secrets s left join admin.tenants t on t.id = s.tenant_id left join admin.users u on u.id = s.updated_by`;

const toView = (r: RawView): SecretViewRow => ({
  ...r,
  version: Number(r.version),
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

function filterSql(f: SecretFilter): SQL[] {
  const w: SQL[] = [];
  if (f.kind !== undefined) w.push(sql`s.kind = ${f.kind}`);
  if (f.tenantId !== undefined) w.push(sql`s.tenant_id = ${f.tenantId}::uuid`);
  return w;
}

/** Theo PK (+ filter route). `forUpdate` khoá hàng secret (không khoá phía outer join). */
export async function readSecret(
  tx: Tx,
  id: string,
  f: SecretFilter,
  forUpdate = false,
): Promise<SecretViewRow | undefined> {
  const where = sql.join([sql`s.id = ${id}::uuid`, ...filterSql(f)], sql` and `);
  const lock = forUpdate ? sql` for update of s` : sql``;
  const [r] = await tx.execute<RawView>(sql`${VIEW} where ${where}${lock}`);
  return r ? toView(r) : undefined;
}

export type ListArgs = SecretFilter & { q?: string; after?: SecretCursor; limit: number };

/** `q` ILIKE tên (escape `\` `%` `_`); cursor `(kind, lower(name), id) >`; trả `limit + 1` hàng để biết trang sau. */
export async function listSecrets(tx: Tx, a: ListArgs): Promise<SecretViewRow[]> {
  const w = filterSql(a);
  if (a.q) w.push(sql`s.name ilike ${`%${a.q.replace(/[\\%_]/g, "\\$&")}%`} escape '\\'`);
  if (a.after) {
    const [k, n, id] = a.after;
    w.push(sql`(s.kind, lower(s.name), s.id) > (${k}, ${n}, ${id}::uuid)`);
  }
  const where = w.length ? sql` where ${sql.join(w, sql` and `)}` : sql``;
  const rows = await tx.execute<RawView>(
    sql`${VIEW}${where} order by s.kind, lower(s.name), s.id limit ${a.limit + 1}`,
  );
  return rows.map(toView);
}

/** Cursor (đúng thứ tự ORDER BY) của một hàng. */
export const cursorOf = (r: SecretViewRow): SecretCursor => [r.kind, r.name.toLowerCase(), r.id];

/** Trùng tên không phân biệt hoa-thường theo (kind, tenant) — `secrets_name_uq`. */
export async function nameTaken(
  tx: Tx,
  kind: HubSecretKind,
  tenantId: string | null,
  name: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`select 1 from hub.secrets where kind = ${kind}
    and tenant_id is not distinct from ${tenantId}::uuid and lower(name) = lower(${name})`);
  return rows.length > 0;
}

export async function tenantExists(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.execute(sql`select 1 from admin.tenants where id = ${id}::uuid`);
  return rows.length > 0;
}

export type InsertArgs = {
  id: string;
  kind: HubSecretKind;
  tenantId: string | null;
  name: string;
  sealed: SealedSecret;
  actorId: string;
};

export async function insertSecret(tx: Tx, a: InsertArgs): Promise<void> {
  await tx.execute(sql`insert into hub.secrets (id, kind, tenant_id, name, ciphertext, iv, key_version,
      created_by, updated_by)
    values (${a.id}::uuid, ${a.kind}, ${a.tenantId}::uuid, ${a.name}, ${bytes(a.sealed.ciphertext)}::bytea,
      ${bytes(a.sealed.iv)}::bytea, ${a.sealed.keyVersion}, ${a.actorId}::uuid, ${a.actorId}::uuid)`);
}

/** Thay giá trị: bản mã + IV mới, `version + 1` (hàng đã khoá FOR UPDATE ở service). */
export async function updateSecretValue(
  tx: Tx,
  id: string,
  sealed: SealedSecret,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`update hub.secrets set ciphertext = ${bytes(sealed.ciphertext)}::bytea,
      iv = ${bytes(sealed.iv)}::bytea, key_version = ${sealed.keyVersion}, version = version + 1,
      updated_at = now(), updated_by = ${actorId}::uuid
    where id = ${id}::uuid`);
}

export async function deleteSecret(tx: Tx, id: string): Promise<void> {
  await tx.execute(sql`delete from hub.secrets where id = ${id}::uuid`);
}

/**
 * Nhánh `used_by` (mỗi nhánh trả `sid, type, id, key`). `source`: nguồn còn sống, CÙNG tenant với secret
 * (`config.credential_secret_id`). K1 (CR-073) `knowledge_hub`: kết nối KH nền tảng trỏ `secret_id`
 * (`kh_connections_secret_idx`), `key = left(name, 64)` (`SecretUsedBySchema.key` ≤ 64).
 */
const USED_BY_BRANCHES: ((ids: readonly string[]) => SQL)[] = [
  (ids) => sql`select p.secret_id as sid, 'provider' as type, p.id, p.key
    from hub.providers p where p.secret_id = any(${uuidArr(ids)})`,
  (ids) => sql`select sec.id as sid, 'source' as type, so.id, so.key
    from hub.sources so join hub.secrets sec
      on sec.id::text = so.config->>'credential_secret_id' and so.tenant_id = sec.tenant_id
    where so.deleted_at is null and so.config->>'credential_secret_id' = any(${textArr(ids)})`,
  (ids) => sql`select k.secret_id as sid, 'knowledge_hub' as type, k.id, left(k.name, 64) as key
    from hub.kh_connections k where k.secret_id = any(${uuidArr(ids)})`,
];

/** D14 · `used_by` của nhiều secret bằng MỘT query (không N+1); mỗi danh sách sắp (type, key). */
export async function usedByMany(
  tx: Tx,
  ids: readonly string[],
): Promise<Map<string, SecretUsedBy[]>> {
  const out = new Map<string, SecretUsedBy[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const union = sql.join(
    USED_BY_BRANCHES.map((b) => sql`(${b(ids)})`),
    sql` union all `,
  );
  const rows = await tx.execute<{
    sid: string;
    type: SecretUsedBy["type"];
    id: string;
    key: string;
  }>(sql`select sid, type, id, key from (${union}) u order by type, key, id`);
  for (const r of rows) out.get(r.sid)?.push({ type: r.type, id: r.id, key: r.key });
  return out;
}

export type SecretMaterial = { ciphertext: Uint8Array; iv: Uint8Array; key_version: number };

/** Bản mã qua hàm SECURITY DEFINER (khớp đúng id + kind + tenant; scope user không mở tenant khác). */
export async function readMaterial(
  tx: Tx,
  ref: { id: string; kind: HubSecretKind; tenantId: string | null },
): Promise<SecretMaterial | undefined> {
  const [r] = await tx.execute<SecretMaterial>(sql`select ciphertext, iv, key_version
    from hub.secret_material(${ref.id}::uuid, ${ref.kind}::text, ${ref.tenantId}::uuid)`);
  return r;
}
