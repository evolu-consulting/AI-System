// dlc-chat-review · `GET /pack/dlc/runs/:id/steps/:step` — nội dung đầy đủ của bước DLC cho modal duyệt trong chat.
// Quyền: run phải thấy được (`stepsView`, RLS tenant) VÀ người gọi là người bắt đầu run, admin (tenant/platform), hoặc quyết được
// một task review đang mở của run (`can_act`). Không đạt ⇒ 404 (không lộ tồn tại). Không dùng cổng gói (nhóm cấp gói ≠ nhóm
// duyệt ⇒ người duyệt có thể bị 403 oan).
// Đọc `dlc.flows` trong scope tenant của người gọi (RLS gói). id lượt DLC = id run quy trình.
import { Hono } from "hono";
import { isAdminRole } from "../../../../lib/admin-role.middleware";
import { appError } from "../../../../lib/errors";
import { parseIdParam } from "../../../../lib/http";
import type { PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import type { PackRunCaller, PackStepsView } from "../../kit/application/pack-runs.ports";
import type { DlcFlow } from "../application/ports";
import { DLC_STEP_KEY_RE, dlcStepDetail } from "../domain/dlc-detail.rules";

export type DlcReadDeps = {
  /** Vắng (engine tắt) ⇒ 404. */
  stepsView?: (u: PackRunCaller, runId: string) => Promise<PackStepsView | null>;
  getFlow: (who: { tenantId: string; userId: string }, id: string) => Promise<DlcFlow | null>;
};

/** Người gọi được đọc nội dung bước của run không (run đã thấy được). */
export function canReadDlcRun(u: PackRunCaller, v: PackStepsView): boolean {
  if (v.started_by === u.userId) return true;
  if (isAdminRole(u.role as Parameters<typeof isAdminRole>[0])) return true;
  return v.steps.some((s) => s.task?.can_act === true);
}

export function dlcReadRoutes(d: DlcReadDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/runs/:id/steps/:step", async (c) => {
    const id = parseIdParam(c);
    const step = c.req.param("step");
    if (!DLC_STEP_KEY_RE.test(step)) throw appError("NOT_FOUND");
    const u = c.get("user");
    const who = { tenantId: u.tenantId, userId: u.userId };
    const caller = { ...who, role: u.role };
    const seen = d.stepsView ? await d.stepsView(caller, id) : null;
    if (!seen || !canReadDlcRun(caller, seen)) throw appError("NOT_FOUND");
    const flow = await d.getFlow(who, id);
    if (!flow) throw appError("NOT_FOUND");
    return c.json({ step, text: dlcStepDetail(flow.state, step) });
  });
  return r;
}
