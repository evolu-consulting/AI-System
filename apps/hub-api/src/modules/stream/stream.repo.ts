// WRK-FR-03 · P13 · SQL trace stream: gộp khoá vào `run_steps.detail` của step đã stream (sau khi step kết thúc). Gọi trong
// `withHubScope(system)` (việc nền của chủ run).
// REVIEW 1 Hub #6: một step có thể có cả `delta_gap` (P11) lẫn `delta_mismatch`/`stream_unparsed` (P12). Trường số của
// từng loại khác khoá nhau; riêng nhãn `stream` bị ghi đè (giữ như cũ = nhãn ghi sau cùng, ca khoá A107–A112 đọc nó)
// → thêm `streams` (mảng mọi nhãn theo thứ tự ghi) để không mất nhãn nào.
import type { Tx } from "@ai/db";
import { runSteps } from "@ai/db/schema/hub";
import { and, eq, sql } from "drizzle-orm";

export async function mergeStepDetail(
  tx: Tx,
  p: { stepId: string; runId: string; patch: Record<string, unknown> & { stream: string } },
): Promise<void> {
  const label = JSON.stringify([p.patch.stream]);
  await tx
    .update(runSteps)
    .set({
      detail: sql`coalesce(${runSteps.detail}, '{}'::jsonb) || ${JSON.stringify(p.patch)}::jsonb
        || jsonb_build_object('streams', coalesce(${runSteps.detail} -> 'streams', '[]'::jsonb) || ${label}::jsonb)`,
    })
    .where(and(eq(runSteps.id, p.stepId), eq(runSteps.runId, p.runId)));
}
