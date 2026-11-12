// CR-127 · X2 · spec §4.1 `GET /open-milestones` + gắn giao dịch vào mốc (business §10.2, BR-49/50). Mỗi hàm MỘT câu văn bản cố định,
// `tenant_id` tường minh ngoài RLS (role `contracts_rw`, RLS tenant + M1). "HĐ đủ điều kiện" = chứng từ HĐ (`doc_type='contract'`) DONE,
// hiệu lực active/expiring, không phải bản đã thay thế; danh sách chọn còn loại HĐ đang tạm khoá (BR-49).
import type { OpenMilestone, OpenMilestonesQuery } from "@ai/contracts/pack-contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ContractItemRef } from "../domain/deal.rules";
import { contractLabelSql } from "./contract-name.sql";

/** Điều kiện HĐ còn hiệu lực của bí danh `c` (dùng chung hai câu). */
const IN_EFFECT = sql`c.doc_type = 'contract' and c.status = 'done' and c.effect in ('active', 'expiring')
  and c.superseded_at is null`;

export type ObligationRef = {
  contract_id: string;
  kind: string;
  direction: "sale" | "purchase";
  /** Đối tác của HĐ = đối tác của giao dịch (`party_key` tên + MST như người nhập). Lệch ⇒ không gắn được (404). */
  partner_match: boolean;
  items: ContractItemRef[];
};

export type OpenMilestonesRepo = {
  list(q: OpenMilestonesQuery): Promise<OpenMilestone[]>;
  /** Đối tác (tên + MST như người nhập) có HĐ hiệu lực cùng hướng chứa một trong các SP? (kể cả HĐ đang tạm khoá — chỉ còn "Không theo HĐ"). */
  partnerHasOpen(q: {
    name: string;
    taxId: string | null;
    direction: "sale" | "purchase";
    productIds: readonly string[];
  }): Promise<boolean>;
  /** Mốc + dòng HĐ của nó; không thấy / HĐ không đủ điều kiện ⇒ null (404, không lộ tồn tại). */
  obligationRef(
    obligationId: string,
    partner: { name: string; taxId: string | null },
  ): Promise<ObligationRef | null>;
};

const pgArr = (ids: readonly string[]) => `{${ids.join(",")}}`;

export function openMilestonesRepo(tx: Tx, t: string): OpenMilestonesRepo {
  return {
    async list(q) {
      const rows = await tx.execute<{
        j: OpenMilestone[];
      }>(sql`select coalesce(jsonb_agg(x.o order by x.due_date, x.seq), '[]'::jsonb) as j
        from (select o.due_date, o.seq, jsonb_build_object('contract_id', c.id, 'contract_name', ${contractLabelSql("c")},
            'obligation_id', o.id, 'kind', o.kind, 'title', o.title, 'due_date', o.due_date::text,
            'remaining', case when o.kind = 'delivery' then
              (select coalesce(sum(m.qty - coalesce(m.delivered, 0)), o.qty)::text from contracts.milestone_items m
                where m.tenant_id = ${t}::uuid and m.milestone_id = o.id)
              else o.amount::text end) as o
          from contracts.contracts c
          join contracts.obligations o on o.tenant_id = c.tenant_id and o.contract_id = c.id
          where c.tenant_id = ${t}::uuid and ${IN_EFFECT} and c.exec_hold_at is null
            and c.partner_key = ${q.party_key} and c.direction = ${q.direction}
            and o.status = 'open' and o.kind in ('delivery', 'payment')
            and (${q.product_id ?? null}::uuid is null
              or (o.kind = 'delivery' and exists (select 1 from contracts.contract_items i
                where i.tenant_id = c.tenant_id and i.contract_id = c.id and i.product_id = ${q.product_id ?? null}::uuid)))
          order by o.due_date, o.seq limit 500) x`);
      return rows[0]?.j ?? [];
    },
    async partnerHasOpen(q) {
      const rows = await tx.execute<{
        ok: boolean;
      }>(sql`select exists (select 1 from contracts.contracts c
          where c.tenant_id = ${t}::uuid and ${IN_EFFECT} and c.direction = ${q.direction}
            and c.partner_key = contracts.party_key(${q.name}::text, ${q.taxId}::text)
            and exists (select 1 from contracts.contract_items i where i.tenant_id = c.tenant_id and i.contract_id = c.id
              and i.product_id = any (${pgArr(q.productIds)}::uuid[]))) as ok`);
      return rows[0]?.ok === true;
    },
    async obligationRef(obligationId, partner) {
      const rows = await tx.execute<{
        j: ObligationRef | null;
      }>(sql`select jsonb_build_object('contract_id', c.id, 'kind', o.kind,
          'direction', c.direction,
          'partner_match', c.partner_key is not distinct from contracts.party_key(${partner.name}::text, ${partner.taxId}::text), 'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'product_id', i.product_id)
            order by i.ord) from contracts.contract_items i where i.tenant_id = c.tenant_id and i.contract_id = c.id), '[]'::jsonb)) as j
        from contracts.obligations o join contracts.contracts c on c.tenant_id = o.tenant_id and c.id = o.contract_id
        where o.tenant_id = ${t}::uuid and o.id = ${obligationId}::uuid and o.status <> 'replaced' and ${IN_EFFECT}`);
      return rows[0]?.j ?? null;
    },
  };
}
