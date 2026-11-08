// CR-124 (contracts 0085/0087) · bảng hộp thư đối tác của gói `contracts` khai cho bộ RLS theo hợp đồng (rls-packs.int.test.ts).
import { userId } from "./builders";
import type { Sql } from "./db";
import type { RlsTable } from "./rls-suite";

const who = userId(901);
const rnd = (pk?: string): string => pk ?? crypto.randomUUID();
const one = async (sql: Sql, text: string, params: unknown[]): Promise<string> => {
  const rows = (await sql.unsafe(
    `${text} returning id::text as id`,
    params as never[],
  )) as unknown as { id: string }[];
  return rows[0]?.id as string;
};
const parent = (sql: Sql, table: string, t: string): Promise<string> =>
  sql
    .unsafe(`select id::text as id from ${table} where tenant_id = $1 order by id limit 1`, [t])
    .then((r) => (r[0] as unknown as { id: string }).id);
/** Bên gửi (partner_sends), bên nhận (partner_inbox), cài đặt nhận (partner_settings, khoá = tenant_id). */
export const partnerTables: RlsTable[] = [
  {
    name: "partner_sends",
    seed: async (o, t) =>
      one(
        o,
        `insert into contracts.partner_sends (tenant_id, contract_id, mailbox_id, channel, to_key, created_by)
         values ($1, $2, $3, 'platform', 'tax:1', $4)`,
        [t, crypto.randomUUID(), crypto.randomUUID(), who],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into contracts.partner_sends (id, tenant_id, contract_id, mailbox_id, channel, to_key, created_by)
         values ($1, $2, $3, $4, 'platform', 'tax:1', $5)`,
        [rnd(pk), t, crypto.randomUUID(), crypto.randomUUID(), who],
      ),
  },
  {
    name: "partner_inbox",
    seed: async (o, t) =>
      one(
        o,
        `insert into contracts.partner_inbox (tenant_id, contract_id, mailbox_id, sender_name, expires_at)
         values ($1, $2, $3, 'Bên gửi', '2027-01-01')`,
        [t, await parent(o, "contracts.contracts", t), crypto.randomUUID()],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into contracts.partner_inbox (id, tenant_id, contract_id, mailbox_id, sender_name, expires_at)
         values ($1, $2, $3, $4, 'Bên gửi', '2027-01-01')`,
        [rnd(pk), t, crypto.randomUUID(), crypto.randomUUID()],
      ),
  },
  {
    name: "partner_settings", // khoá chính = tenant_id
    pk: "tenant_id",
    seed: async (o, t) => {
      await o.unsafe("insert into contracts.partner_settings (tenant_id) values ($1)", [t]);
      return t;
    },
    insert: (tx, t) =>
      tx.unsafe("insert into contracts.partner_settings (tenant_id) values ($1)", [t]),
  },
];
