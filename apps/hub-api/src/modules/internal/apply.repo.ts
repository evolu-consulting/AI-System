// HUB-FR-129 · HUB-FR-130 · HUB-BR-14 · PC2-R13 · P-c2 · truy vấn kênh báo cáo Áp (plan §6.3). Scope `system` + `tenant_id`
// tường minh (bảng RLS "T"). Dùng lại `jobByTokenAnyStatus`/`insertOutputFile`/`stillRunning` của kênh tự-sửa
// (`autofix.repo.ts`) — cùng hình job (jobs ⟕ runs) + attachment output text/plain.
import type { Tx } from "@ai/db";
import { autofixApplies, type NewAutofixApply } from "@ai/db/schema/hub-autofix";
import { sql } from "drizzle-orm";

/**
 * `autofix_results` của diff đã áp (`diff_attachment_id = patch.id`, cùng tenant). Không có ⇒ null (cột `autofix_result_id`
 * FK SET NULL). Một query, dùng index `diff_attachment_id` của hàng tự-sửa.
 */
export async function autofixResultIdByDiff(
  tx: Tx,
  tenantId: string,
  diffAttachmentId: string,
): Promise<string | null> {
  const rows = await tx.execute<{ id: string }>(sql`SELECT id FROM hub.autofix_results
    WHERE diff_attachment_id = ${diffAttachmentId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`);
  return rows[0]?.id ?? null;
}

export async function insertApply(tx: Tx, row: NewAutofixApply): Promise<string> {
  const [r] = await tx.insert(autofixApplies).values(row).returning({ id: autofixApplies.id });
  if (!r) throw new Error("autofix_applies insert returned no row");
  return r.id;
}

/** 23505 trên `autofix_applies_job_uq` (báo cáo lần 2 cùng job) — lỗi pg có thể nằm ở `cause` (DrizzleQueryError). */
export function isApplyExists(err: unknown): boolean {
  const e = err as { code?: unknown; constraint_name?: unknown; cause?: unknown } | null;
  const pg = (e?.code === undefined ? e?.cause : e) as typeof e;
  return pg?.code === "23505" && pg.constraint_name === "autofix_applies_job_uq";
}
