// ADM-FR-50, ADM-NFR-07 · truy vấn admin.secrets (scope platform, RLS). admin_rw KHÔNG có SELECT trên `ciphertext`/`iv`
// (0004_catalog_rls): mọi select/returning phải liệt kê cột, không `select()` trần, không `.returning()` trần.
import { secrets, type Tx, users, workflows } from "@ai/db";
import { and, asc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import { likeArg } from "../../lib/sql";

export type SecretRow = {
  id: string;
  name: string;
  last4: string;
  note: string | null;
  usedBy: string[];
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

const usedBy = sql<string[]>`array(select ${workflows.key} from ${workflows}
  where ${workflows.secretId} = ${secrets.id} order by ${workflows.key})`;
const isUsed = sql`exists(select 1 from ${workflows} where ${workflows.secretId} = ${secrets.id})`;

const rowCols = {
  id: secrets.id,
  name: secrets.name,
  last4: secrets.last4,
  note: secrets.note,
  usedBy,
  createdAt: secrets.createdAt,
  updatedAt: secrets.updatedAt,
  updatedBy: users.username,
};

export type SecretFilter = { q?: string; used?: boolean; limit: number; offset: number };

function baseWhere(f: SecretFilter): SQL | undefined {
  if (!f.q) return undefined;
  const q = likeArg(f.q);
  return or(ilike(secrets.name, q), ilike(secrets.note, q));
}

export async function listSecrets(tx: Tx, f: SecretFilter) {
  const used = f.used === undefined ? undefined : f.used ? isUsed : sql`not ${isUsed}`;
  const rows = await tx
    .select({ ...rowCols, total: sql<number>`count(*) over()`.mapWith(Number) })
    .from(secrets)
    .leftJoin(users, eq(users.id, secrets.updatedBy))
    .where(and(baseWhere(f), used))
    .orderBy(asc(secrets.name))
    .limit(f.limit)
    .offset(f.offset);
  const [c] = await tx
    .select({
      all: sql<number>`count(*)`.mapWith(Number),
      used: sql<number>`count(*) filter (where ${isUsed})`.mapWith(Number),
      unused: sql<number>`count(*) filter (where not ${isUsed})`.mapWith(Number),
    })
    .from(secrets)
    .where(baseWhere(f));
  return {
    rows: rows as (SecretRow & { total: number })[],
    counts: c ?? { all: 0, used: 0, unused: 0 },
  };
}

export async function findSecretRow(tx: Tx, name: string): Promise<SecretRow | null> {
  const [row] = await tx
    .select(rowCols)
    .from(secrets)
    .leftJoin(users, eq(users.id, secrets.updatedBy))
    .where(eq(secrets.name, name))
    .limit(1);
  return (row as SecretRow | undefined) ?? null;
}

/** `FOR NO KEY UPDATE` (sắp ghi hàng; plan §5.1). Trả id hoặc null. */
export async function lockSecretByName(tx: Tx, name: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: secrets.id })
    .from(secrets)
    .where(eq(secrets.name, name))
    .for("no key update");
  return row?.id ?? null;
}

/** `FOR SHARE`: giữ secret được workflow tham chiếu không bị xoá tới khi commit. */
export async function shareSecretById(
  tx: Tx,
  id: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await tx
    .select({ id: secrets.id, name: secrets.name })
    .from(secrets)
    .where(eq(secrets.id, id))
    .for("share");
  return row ?? null;
}

export async function usedByOf(tx: Tx, id: string): Promise<string[]> {
  const rows = await tx
    .select({ key: workflows.key })
    .from(workflows)
    .where(eq(workflows.secretId, id))
    .orderBy(asc(workflows.key));
  return rows.map((r) => r.key);
}

export type Sealed = { ciphertext: Buffer; iv: Buffer; keyVersion: number; last4: string };

export async function insertSecret(
  tx: Tx,
  s: Sealed & { id: string; name: string; note: string | null; actorId: string },
): Promise<void> {
  await tx.insert(secrets).values({
    id: s.id,
    name: s.name,
    ciphertext: s.ciphertext,
    iv: s.iv,
    keyVersion: s.keyVersion,
    last4: s.last4,
    note: s.note,
    updatedBy: s.actorId,
  });
}

export async function updateSecret(
  tx: Tx,
  id: string,
  set: Partial<Sealed> & { note?: string | null; actorId: string },
): Promise<void> {
  const { actorId, ...rest } = set;
  await tx
    .update(secrets)
    .set({ ...rest, updatedBy: actorId, updatedAt: sql`now()` })
    .where(eq(secrets.id, id));
}

export async function deleteSecret(tx: Tx, id: string): Promise<void> {
  await tx.delete(secrets).where(eq(secrets.id, id));
}
