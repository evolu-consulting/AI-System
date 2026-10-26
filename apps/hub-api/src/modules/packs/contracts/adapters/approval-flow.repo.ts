// contract-flow S2 · mẫu luồng duyệt theo tenant (`contracts.approval_flows`, RLS FORCE qua tx `PackUow`, role `contracts_rw`).
// Lưu có khoá lạc quan: UPDATE khi `version` khớp; chưa có hàng ⇒ chỉ chèn khi người gửi thấy mẫu mặc định (version 1) ⇒
// version 2. Lệch ⇒ null (use case trả 409).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { StoredFlow } from "../application/approval-flow.usecase";
import type { FlowStep } from "../domain/approval-flow.types";
import { settingsRepo } from "./approval-settings.repo";

type Row = { version: number; steps: FlowStep[]; updated_at: string | Date };
const toFlow = (r: Row | undefined): StoredFlow | null =>
  r
    ? {
        version: Number(r.version),
        steps: r.steps,
        updatedAt: new Date(r.updated_at).toISOString(),
      }
    : null;

export function approvalFlowRepo(tx: Tx, tid: string) {
  return {
    settings: () => settingsRepo(tx, tid).settings(),
    async settingsRev(): Promise<number> {
      const [r] = await tx.execute<{
        rev: number;
      }>(sql`select (extract(epoch from updated_at) / 60)::bigint
        - 26297280 as rev from contracts.approval_settings where tenant_id = ${tid}::uuid`);
      return Math.max(0, Number(r?.rev ?? 0));
    },
    async flow(): Promise<StoredFlow | null> {
      const [r] = await tx.execute<Row>(sql`select version, steps, updated_at
        from contracts.approval_flows where tenant_id = ${tid}::uuid`);
      return toFlow(r);
    },
    async save(
      steps: readonly FlowStep[],
      expected: number,
      actor: string,
    ): Promise<StoredFlow | null> {
      const json = JSON.stringify(steps);
      const [u] = await tx.execute<Row>(sql`update contracts.approval_flows
        set version = version + 1, steps = ${json}::jsonb, updated_by = ${actor}::uuid, updated_at = now()
        where tenant_id = ${tid}::uuid and version = ${expected}::int
        returning version, steps, updated_at`);
      if (u || expected !== 1) return toFlow(u);
      // Mẫu mặc định (version 1, chưa có hàng) ⇒ chèn version 2; đua chèn ⇒ 0 hàng ⇒ 409.
      const [r] = await tx.execute<Row>(sql`insert into contracts.approval_flows
          (tenant_id, version, steps, updated_by)
        values (${tid}::uuid, 2, ${json}::jsonb, ${actor}::uuid)
        on conflict (tenant_id) do nothing
        returning version, steps, updated_at`);
      return toFlow(r);
    },
  };
}
