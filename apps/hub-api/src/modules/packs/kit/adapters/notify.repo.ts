// N3-FR-01 · N3-NFR-02 · `Notifier` trên hàm `notify.enqueue(source, lô jsonb)` (SECURITY DEFINER, migrations-hub/0040). Role gói
// `<k>_rw` chỉ có EXECUTE hàm này — không đọc/ghi bảng thông báo. Tenant lấy từ `app.tenant_id` của tx (`withPackScope`).
// SQL văn bản cố định, lô qua MỘT tham số jsonb, 0 câu khi lô rỗng.
import { type NotifyInput as ContractInput, PackKeySchema } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Notifier, NotifyInput } from "../application/notify";

// Kiểu lớp 2 phải khớp contract (hai chiều) — lệch là lỗi biên dịch.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _same: Same<NotifyInput, ContractInput> = true;
void _same;

/** Kiểm khoá gói MỘT lần lúc mount; mỗi tx chỉ dựng closure. */
export function notifierFor(packKey: string): (tx: Tx) => Notifier {
  const source = PackKeySchema.parse(packKey);
  return (tx) => ({
    enqueue: async (rows) => {
      if (rows.length === 0) return 0;
      const batch = JSON.stringify(rows);
      const res = await tx.execute<{ n: number }>(
        sql`select notify.enqueue(${source}, ${batch}::jsonb) as n`,
      );
      return Number(res[0]?.n ?? 0);
    },
  });
}
