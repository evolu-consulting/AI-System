// PK-FR-08 · PK-NFR-03 · ADR-0016 §2 · N1 plan §8: `IndexOutbox` trên bảng khung `<k>.index_outbox` (role `<k>_rw` chỉ có
// INSERT, RLS FORCE theo tenant). Chạy trong tx của `PackUow` ⇒ cùng commit/rollback với lệnh ghi của gói. SQL văn bản hằng
// mỗi gói (tên schema = khoá gói đã kiểm `PackKeySchema`), lô qua MỘT tham số jsonb, không join `unnest`; rỗng ⇒ 0 câu.
import type { IndexOutboxRow as ContractRow } from "@ai/contracts";
import { PackKeySchema } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { IndexOutbox, IndexOutboxRow } from "../application/index-outbox";

// Kiểu lớp 2 phải trùng contract (hai chiều) — lệch là lỗi biên dịch.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _sameRow: Same<IndexOutboxRow, ContractRow> = true;
void _sameRow;

export function indexOutboxRepo(tx: Tx, packKey: string, tenantId: string): IndexOutbox {
  const table = sql.raw(`${PackKeySchema.parse(packKey)}.index_outbox`);
  return {
    enqueue: async (rows) => {
      if (rows.length === 0) return;
      const batch = JSON.stringify(rows);
      await tx.execute(sql`insert into ${table} (tenant_id, entity, entity_id, op)
        select ${tenantId}::uuid, x.entity, x.entity_id, x.op
        from jsonb_to_recordset(${batch}::jsonb) as x(entity text, entity_id uuid, op text)`);
    },
  };
}
