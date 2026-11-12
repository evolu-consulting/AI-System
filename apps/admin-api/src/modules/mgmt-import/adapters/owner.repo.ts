// niti-import · `OwnerStore` trên Postgres: pool `hub_api` (NOBYPASSRLS), tx `withPackScope` gói `contracts` (role `contracts_rw`,
// RLS FORCE theo tenant, việc nền ⇒ không user). Ghi: MỘT tx mỗi HĐ (mọi bảng của HĐ đó, câu ghi I1 có sẵn — mỗi bảng một câu) +
// đánh dấu "đã nhắc" mọi mốc nhắc đã qua của HĐ vừa chèn (vòng nhắc HD4 không gửi thông báo cho hạn cũ). Lô nhập nhận diện bằng
// nhãn `data.mgmt_source` của sự kiện `mgmt_import` (HĐ) / của sự kiện sổ. Hoàn tác đi qua `contracts.delete_contract` (đường xoá
// của app: một tx mỗi HĐ, sổ chỉ thêm ⇒ thêm dòng huỷ) — không dùng role chủ.
import type { Db, Tx } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { type SQL, sql } from "drizzle-orm";
import type { BatchState, OwnerStore } from "../application/owner-ports";
import type { Row, TableName } from "../domain/plan";
import { INSERTS } from "./target.sql";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];
const scope = (tenantId: string) => ({ packKey: "contracts", tenantId, userId: null });

/** HĐ của lô (nhãn nguồn trên sự kiện `mgmt_import`). */
const BATCH = (tid: string, source: string) => sql`(select c.id from contracts.contracts c
  where c.tenant_id = ${tid}::uuid and exists (select 1 from contracts.contract_events e where e.tenant_id = ${tid}::uuid
    and e.contract_id = c.id and e.type = 'mgmt_import' and e.data->>'mgmt_source' = ${source}))`;

function stateQ(tid: string, source: string): SQL {
  const T = sql`${tid}::uuid`;
  const B = BATCH(tid, source);
  return sql`with c as (
      select c.id, c.kind, c.parent_id, c.number, c.title, c.direction, c.seller, c.buyer, c.value,
        c.fields->'signed_date'->>'value' as signed_date, c.fields->'start_date'->>'value' as start_date,
        to_char(c.end_date, 'YYYY-MM-DD') as end_date, c.file_id, c.owner_user_id, c.status
      from contracts.contracts c where c.tenant_id = ${T} and c.id in ${B})
    select
      (select coalesce(jsonb_agg(to_jsonb(c) order by c.kind, c.number, c.id), '[]'::jsonb) from c) as contracts,
      (select count(*)::int from contracts.contract_items i where i.tenant_id = ${T} and i.contract_id in (select id from c)) as items,
      (select count(*)::int from contracts.approvals a where a.tenant_id = ${T} and a.contract_id in (select id from c)) as approvals,
      (select count(*)::int from contracts.obligations o where o.tenant_id = ${T} and o.contract_id in (select id from c)) as obligations,
      (select coalesce(sum(o.amount), 0)::text from contracts.obligations o where o.tenant_id = ${T} and o.contract_id in (select id from c)) as obligations_amount,
      (select count(*)::int from contracts.contract_events e where e.tenant_id = ${T} and e.contract_id in (select id from c)) as events,
      (select count(*)::int from contracts.contract_reminders r where r.tenant_id = ${T} and r.contract_id in (select id from c)) as reminders,
      (select count(*)::int from contracts.files f where f.tenant_id = ${T} and f.id in (select file_id from c)) as files,
      (select count(*)::int from contracts.partner_events e where e.tenant_id = ${T} and e.data->>'mgmt_source' = ${source}) as partner_events,
      (select coalesce(sum(e.amount), 0)::text from contracts.partner_events e where e.tenant_id = ${T} and e.data->>'mgmt_source' = ${source}) as partner_events_amount,
      (select count(*)::int from contracts.partner_events e where e.tenant_id = ${T} and e.data->>'mgmt_source' = ${source}
        and exists (select 1 from contracts.partner_event_voids v where v.tenant_id = ${T} and v.event_id = e.id)) as partner_events_voided,
      (select count(*)::int from contracts.partner_events e where e.tenant_id = ${T} and e.data->>'mgmt_source' = ${source}
        and e.type = 'rating') as ratings,
      (select count(*)::int from contracts.contracts a where a.tenant_id = ${T} and a.parent_id in (select id from c)
        and a.id not in (select id from c)) as foreign_children`;
}

type StateRow = Omit<BatchState, "contracts" | "obligations_amount" | "partner_events_amount"> & {
  contracts: Row[];
  obligations_amount: string;
  partner_events_amount: string;
};

export function createOwnerStore(db: Db): OwnerStore {
  return {
    async writeUnit(tid, tables, _today) {
      return withPackScope(db, scope(tid), async (tx) => {
        const out: Partial<Record<TableName, number>> = {};
        for (const [table, rows] of tables) {
          if (rows.length === 0) continue;
          out[table] = (await run(tx, INSERTS[table](tid, JSON.stringify(rows)))).length;
        }
        // CR-127 K6: hết chuông cứng ⇒ không còn đánh dấu mốc nhắc đã tới (`contract_reminders` kênh `mgmt_import`).
        return out;
      });
    },
    async state(tid, source) {
      const [r] = await withPackScope(db, scope(tid), (tx) =>
        run<StateRow>(tx, stateQ(tid, source)),
      );
      const x = r as StateRow;
      return {
        ...x,
        obligations_amount: BigInt(x.obligations_amount),
        partner_events_amount: BigInt(x.partner_events_amount),
      };
    },
    async deleteContract(tid, id) {
      const [r] = await withPackScope(db, scope(tid), (tx) =>
        run<{ r: unknown }>(
          tx,
          sql`select contracts.delete_contract(${id}::uuid, ${tid}::uuid) as r`,
        ),
      );
      return r?.r != null;
    },
    async voidEvents(tid, source) {
      return withPackScope(
        db,
        scope(tid),
        async (tx) =>
          (
            await run(
              tx,
              sql`insert into contracts.partner_event_voids (event_id, tenant_id, by_user)
              select e.id, ${tid}::uuid, null from contracts.partner_events e
              where e.tenant_id = ${tid}::uuid and e.data->>'mgmt_source' = ${source}
                and not exists (select 1 from contracts.partner_event_voids v where v.tenant_id = ${tid}::uuid and v.event_id = e.id)
              on conflict do nothing returning 1`,
            )
          ).length,
      );
    },
  };
}
