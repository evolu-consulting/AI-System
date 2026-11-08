// CR-125 G7 · dựng dữ liệu hộp thư đối tác cho int/perf (theo tập: 3 câu, không theo hàng). Chỉ dùng trong test.
import { contracts } from "./builders";
import type { Sql } from "./db";

/**
 * `total` HĐ nhận của `tenant` (`source='partner_inbox'`), trong đó `pending` hàng đầu ở trạng thái chờ, còn lại đã `confirmed`.
 * `from` = số bắt đầu id HĐ (khác nhau giữa các tenant để id không trùng).
 */
export async function seedPartnerInbox(
  o: Sql,
  tenant: string,
  createdBy: string,
  opts: { from: number; total: number; pending: number },
): Promise<void> {
  await contracts(o, tenant, opts.total, { from: opts.from, createdBy, status: "needs_review" });
  await o`update contracts.contracts set source = 'partner_inbox' where tenant_id = ${tenant}::uuid`;
  await o`insert into contracts.partner_inbox (tenant_id, contract_id, mailbox_id, sender_name, status, expires_at)
    select ${tenant}::uuid, c.id, gen_random_uuid(), 'Công ty đối tác',
      case when row_number() over (order by c.id) <= ${opts.pending}::int then 'pending' else 'confirmed' end,
      now() + interval '7 days'
    from contracts.contracts c where c.tenant_id = ${tenant}::uuid and c.source = 'partner_inbox'`;
}
