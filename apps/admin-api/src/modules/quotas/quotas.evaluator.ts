// ADM-FR-41 · M4-R04, R05 · Q2b · evaluator cảnh báo quota (plan M4 §5.2). Điểm gọi chốt ở T3 (sau commit PUT quota,
// không await); thân hàm (quota_alerts + mail) làm ở T4 — hiện là no-op.
import type { Db } from "@ai/db";

export type EvaluatorCtx = { db: Db; now: () => Date };

/** Không bao giờ ném ra ngoài luồng gọi (nơi gọi vẫn `.catch(log)`). T4: đọc quota/usage → alertsDue → mail. */
export async function evaluateTenant(_ctx: EvaluatorCtx, _tenantId: string): Promise<void> {}
