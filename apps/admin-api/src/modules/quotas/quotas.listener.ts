// ADM-FR-41 · Q2b · LISTEN `quota_threshold` (plan M4 §5.2, plan-contract §2.5): Hub NOTIFY `{tenant_id}` khi ghi usage →
// gộp theo tenant trong 2 s rồi chạy evaluator. Payload sai → log warn, bỏ qua (tiến trình sống tiếp).
import { QUOTA_THRESHOLD_CHANNEL, QuotaThresholdPayloadSchema } from "@ai/contracts";
import { logger } from "../../lib/logger";
import { safeErrorFields } from "../../lib/pg-errors";
import { type EvaluatorCtx, evaluateTenant } from "./quotas.evaluator";

export const COALESCE_MS = 2000;

/** Tenant id hợp lệ từ payload NOTIFY, hoặc null (JSON hỏng / sai schema). */
export function parseThresholdPayload(payload: string): string | null {
  let v: unknown;
  try {
    v = JSON.parse(payload);
  } catch {
    return null;
  }
  const r = QuotaThresholdPayloadSchema.safeParse(v);
  return r.success ? r.data.tenant_id : null;
}

/**
 * Bắt đầu LISTEN (không chặn). Trả hàm dừng: huỷ hẹn giờ chưa chạy + UNLISTEN. `db.close()` cũng đóng kết nối LISTEN.
 */
export function startQuotaListener(
  ctx: EvaluatorCtx,
  o: { coalesceMs?: number } = {},
): () => Promise<void> {
  const wait = o.coalesceMs ?? COALESCE_MS;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;
  const onPayload = (payload: string) => {
    const tenantId = parseThresholdPayload(payload);
    if (tenantId === null) {
      logger.warn("quota_threshold payload invalid", { module: "quotas", bytes: payload.length });
      return;
    }
    if (stopped || timers.has(tenantId)) return;
    const t = setTimeout(() => {
      timers.delete(tenantId);
      if (!stopped) void evaluateTenant(ctx, tenantId);
    }, wait);
    (t as { unref?: () => void }).unref?.();
    timers.set(tenantId, t);
  };
  const sub = ctx.db.listen(QUOTA_THRESHOLD_CHANNEL, onPayload).catch((err) => {
    logger.error("quota_threshold listen failed", { module: "quotas", ...safeErrorFields(err) });
    return null;
  });
  return async () => {
    stopped = true;
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    const unlisten = await sub;
    await unlisten?.().catch(() => undefined);
  };
}
