// HD-FR-02 · HD-FR-06 · HD-AC06 · HD1 plan §5 §6 (Luật 4c): ghi trường HĐ trong tx `PackUow` (role `contracts_rw`, RLS FORCE).
// Hai câu văn bản HẰNG: khoá hàng `FOR UPDATE` theo PK + `tenant_id` tường minh; một CTE UPDATE (`version = expected` — lưới an
// toàn thứ hai sau khoá) + INSERT event `field_edited`. Cột sinh (`value`, `buyer`, `search_key`…) tự tính lại khi ghi `fields`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  ContractFieldsRepo,
  LockedContract,
  SavedContract,
} from "../application/patch-fields.usecase";
import { editEventData } from "../domain/edit-event.rules";

type Raw = { version: number; updated_at: string | Date };

const iso = (v: string | Date): string => new Date(v).toISOString();
const json = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);

export function contractFieldsRepo(tx: Tx, tenantId: string): ContractFieldsRepo {
  return {
    lock: async (id): Promise<LockedContract | null> => {
      const rows = await tx.execute<
        Raw & { fields: unknown; status: string; run_id: string | null }
      >(sql`select c.version, c.updated_at, c.fields, c.status, c.run_id
        from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${tenantId}::uuid for update`);
      const r = rows[0];
      return r
        ? {
            version: r.version,
            updated_at: iso(r.updated_at),
            fields: json(r.fields),
            status: r.status,
            run_id: r.run_id,
          }
        : null;
    },
    save: async (id, s): Promise<SavedContract> => {
      const rows = await tx.execute<Raw>(sql`with u as (
          update contracts.contracts set fields = ${JSON.stringify(s.fields)}::jsonb, version = version + 1, updated_at = now(),
            -- HD3 D3-13 · mở lại duyệt: bỏ "Đã duyệt" + gỡ run cũ trong CÙNG câu (version tăng một lần)
            status = case when ${s.reopen === true} then 'needs_review' else status end,
            confirmed_at = case when ${s.reopen === true} then null else confirmed_at end,
            confirmed_by = case when ${s.reopen === true} then null else confirmed_by end,
            run_id = case when ${s.reopen === true} then null else run_id end
          where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and version = ${s.expected}::int
          returning id, version, updated_at),
        e as (
          insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${tenantId}::uuid, u.id, 'field_edited', ${s.actor}::uuid, ${JSON.stringify(s.reopen ? { ...editEventData(s.changes), approval_reopened: true } : editEventData(s.changes))}::jsonb
          from u)
        select u.version, u.updated_at from u`);
      const r = rows[0];
      // Không xảy ra khi đã giữ khoá hàng (version vừa đọc dưới FOR UPDATE) — ném ⇒ rollback cả tx.
      if (!r) throw new Error("patch-fields: row vanished under lock");
      return { version: r.version, updated_at: iso(r.updated_at) };
    },
  };
}
