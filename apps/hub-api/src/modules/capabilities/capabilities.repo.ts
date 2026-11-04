// CR-118 · UW-FR-16..19 · phần Hub chưa có trong ảnh ConfigCache: khe flow (mặc định + gán theo tenant, MỌI tenant) và
// flow độc lập (def không gắn khe). Đúng 2 câu, văn bản cố định, không theo số tenant (Luật 4c); scope system, chỉ đọc.
// Ghi khe đi qua `withConfigWrite` (bump `hub_config_version`) ⇒ cache theo version Hub là đủ. Bỏ khe/def của DLC (D5).
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../lib/db";
import type { SlotRow } from "./capabilities.rules";

export type StandaloneRow = {
  id: string;
  name: string;
  version: number | null;
  tenantId: string | null;
};
export type HubExtras = { slots: SlotRow[]; standalone: StandaloneRow[] };

const STANDALONE_MAX = 500;

type SlotSql = {
  tenant_id: string | null;
  slot: string;
  def_id: string | null;
  def_name: string | null;
  version: number | null;
};
type DefSql = { id: string; name: string; version: number | null; tenant_id: string | null };

const slotRows = (tx: Tx) =>
  tx.execute<SlotSql>(sql`select null::text as tenant_id, s.slot, d.id::text as def_id, d.name as def_name,
      d.published_version as version
    from hub.process_slots s left join hub.process_defs d on d.id = s.default_def_id and d.deleted_at is null
    where s.slot not like 'dlc.%'
    union all
    select a.tenant_id::text, a.slot, d.id::text, d.name, d.published_version
    from hub.process_slot_assignments a left join hub.process_defs d on d.id = a.def_id and d.deleted_at is null
    where a.slot not like 'dlc.%'`);

const standaloneRows = (tx: Tx) =>
  tx.execute<DefSql>(sql`select d.id::text as id, d.name, d.published_version as version,
      d.tenant_id::text as tenant_id
    from hub.process_defs d
    where d.deleted_at is null and d.pack_version is null and d.key not like 'dlc%'
      and not exists (select 1 from hub.process_slots s where s.default_def_id = d.id)
      and not exists (select 1 from hub.process_slot_assignments a where a.def_id = d.id)
    order by d.name, d.id limit ${STANDALONE_MAX}`);

export function loadHubExtras(db: Db): Promise<HubExtras> {
  return withHubScope(
    db,
    { kind: "system" },
    async (tx) => {
      const s = await slotRows(tx);
      const d = await standaloneRows(tx);
      return {
        slots: [...s].map((r) => ({
          tenantId: r.tenant_id,
          slot: r.slot,
          defId: r.def_id,
          defName: r.def_name,
          version: r.version,
        })),
        standalone: [...d].map((r) => ({
          id: r.id,
          name: r.name,
          version: r.version,
          tenantId: r.tenant_id,
        })),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
