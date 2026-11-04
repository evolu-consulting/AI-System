// dlc-agent-flows · SQL đọc def thư viện quy trình ĐÃ xuất bản của các khe DLC (`tenant_id NULL`, `slot`, `published_version`)
// cho Agent Forge › "Quy trình DLC". Gọi trong tx scope system; một câu cố định theo khe.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type DlcDefRow = { slot: string; key: string; name: string; published_version: number };

/** Def thư viện còn sống, đã xuất bản, thuộc một trong `slots` (khoá khe hằng, khớp `SLOT_KEY_RE` ⇒ literal mảng an toàn). */
export function publishedSlotDefs(tx: Tx, slots: readonly string[]): Promise<DlcDefRow[]> {
  if (slots.length === 0) return Promise.resolve([]);
  return tx.execute<DlcDefRow>(sql`select d.slot, d.key, d.name, d.published_version
    from hub.process_defs d
    where d.tenant_id is null and d.deleted_at is null and d.published_version is not null
      and d.slot = any(${`{${slots.join(",")}}`}::text[])
    order by d.slot, d.name, d.key`);
}
