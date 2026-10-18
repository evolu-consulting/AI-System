// HUB-FR-129 · HUB-FR-130 · PC2-R13 · PC2-R16 · P-c2 · plan §6.2, §6.4 · đọc dùng chung cho stage Áp (launcher + driver):
// đầu run đã khoá, ngữ cảnh tự-sửa cho PR, credential nguồn. Ghi output + chuyển trạng thái (`writeApplyOutput`,
// `settleApply`) ở `adapters/runs/hub-settle.ts` (P-d2 T18s).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { headOf, type RunHead, type SnapStage } from "./team-runner";

/** `RunHead` + `id` (headOf không trả id). */
export type LoadedHead = RunHead & { id: string };
/** Stage Áp đã khoá (status + idx + attempt). */
export type ApplyStage = { id: string; stage_idx: number; status: string; attempt: number };

export async function loadHead(tx: Tx, runId: string): Promise<LoadedHead | null> {
  const h = await headOf(tx, runId);
  return h ? { ...h, id: runId } : null;
}

/** PC2-R14/C31 · tên stage tự-sửa + vòng + output đã duyệt (cho tiêu đề/thân PR). Tx scope system, lọc tenant. */
export async function fixContext(
  tx: Tx,
  head: LoadedHead,
  resultId: string | null,
): Promise<{ name: string; round: number; output: string | null }> {
  const stages = head.snapshot.stages as SnapStage[];
  const fixIdx = stages.findIndex((s) => s.autofix);
  const name = fixIdx >= 0 ? (stages[fixIdx]?.name ?? "") : "";
  const [r] = resultId
    ? await tx.execute<{ round: number }>(sql`select round from hub.autofix_results
        where id = ${resultId} and tenant_id = ${head.tenant_id}`)
    : [];
  const [o] =
    fixIdx >= 0
      ? await tx.execute<{ content: string }>(sql`select content from hub.process_outputs
          where process_run_id = ${head.id} and tenant_id = ${head.tenant_id} and stage_idx = ${fixIdx}
          order by version desc limit 1`)
      : [];
  return { name, round: Number(r?.round ?? 1), output: o?.content ?? null };
}

/** PC2-R11 · `credential_secret_id` của nguồn hiện tại (tenant job); null ⇒ không khoá. */
export async function credentialIdOf(
  tx: Tx,
  tenantId: string,
  sourceId: string,
): Promise<string | null> {
  const [r] = await tx.execute<{
    cid: string | null;
  }>(sql`select config->>'credential_secret_id' as cid
    from hub.sources where id = ${sourceId} and tenant_id = ${tenantId} and deleted_at is null`);
  return r?.cid ?? null;
}
