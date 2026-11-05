// CR-121 Q-1 · nhãn HĐ theo TẬP id cho Hub (trang chi tiết lượt chạy): mã HĐ thật (`number`, cột sinh từ `fields`) + tên HĐ.
// Chạy TRONG tx `PackUow.system` (role `contracts_rw`, RLS tenant; việc nền ⇒ `sees_all()`): MỘT câu `= any` (ids qua một tham số JSON ⇒ văn bản SQL cố định), lọc `tenant_id` tường minh.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type ContractNameRow = { id: string; number: string | null; title: string };

/** `HĐ <số> · <tên>`; thiếu số ⇒ `HĐ <tên>`. */
export function contractRecordLabel(r: { number: string | null; title: string }): string {
  const title = r.title.trim();
  return r.number ? `HĐ ${r.number}${title ? ` · ${title}` : ""}` : `HĐ ${title}`;
}

export function recordLabelRepo(tx: Tx, t: string) {
  return {
    contractNames: async (ids: readonly string[]): Promise<ContractNameRow[]> => {
      const rows = await tx.execute<ContractNameRow>(sql`select c.id, c.number, c.title
        from contracts.contracts c
        where c.tenant_id = ${t}::uuid
          and c.id = any(array(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid))`);
      return [...rows];
    },
  };
}
