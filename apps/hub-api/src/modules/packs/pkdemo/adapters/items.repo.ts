// PK-FR-09 · PK-NFR-05 · N1 plan §10: repo `pkdemo` trong tx của `PackUow` (role `pkdemo_rw`, RLS FORCE theo tenant). SQL văn
// bản hằng, số câu cố định: ghi = 1 câu (CTE cha + con từ MỘT tham số jsonb, không join `unnest`), đọc = 1 câu (cha + `json_agg`
// con qua `item_lines(item_id)`). Mọi câu lọc `tenant_id` tường minh ngoài RLS.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { indexOutboxRepo } from "../../kit/adapters/index-outbox.repo";
import type { ItemsRepo, PkdemoRepos } from "../application/ports";
import type { Item, ItemLine } from "../domain/item";
import { PKDEMO_KEY } from "./pkdemo.routes";

type ItemRow = { id: string; title: string; lines: ItemLine[] | string };

export function itemsRepo(tx: Tx, tenantId: string): ItemsRepo {
  return {
    insert: async (item) => {
      const lines = JSON.stringify(item.lines);
      await tx.execute(sql`with i as (
          insert into pkdemo.items (id, tenant_id, title) values (${item.id}::uuid, ${tenantId}::uuid, ${item.title}))
        insert into pkdemo.item_lines (id, tenant_id, item_id, text)
        select x.id, ${tenantId}::uuid, ${item.id}::uuid, x.text
        from jsonb_to_recordset(${lines}::jsonb) as x(id uuid, text text)`);
    },
    get: async (id) => {
      const rows = await tx.execute<ItemRow>(sql`select i.id, i.title,
          coalesce((select json_agg(json_build_object('id', l.id, 'text', l.text) order by l.id)
            from pkdemo.item_lines l where l.item_id = i.id and l.tenant_id = i.tenant_id), '[]'::json) as lines
        from pkdemo.items i where i.id = ${id}::uuid and i.tenant_id = ${tenantId}::uuid`);
      const r = rows[0];
      if (!r) return null;
      const lines = typeof r.lines === "string" ? (JSON.parse(r.lines) as ItemLine[]) : r.lines;
      return { id: r.id, title: r.title, lines } satisfies Item;
    },
  };
}

/** Repo của gói trong một tx (`createPackUow(db, "pkdemo", pkdemoRepos)`). */
export const pkdemoRepos = (tx: Tx, tenantId: string): PkdemoRepos => ({
  items: itemsRepo(tx, tenantId),
  outbox: indexOutboxRepo(tx, PKDEMO_KEY, tenantId),
});
