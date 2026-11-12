// HUB-FR-107 · HUB-FR-109 · PF1 · cổng kiểm (plan §9, plan-contract §3): `POST /review-tasks/:id/decision` (Đạt/Chưa đạt),
// `POST /process-runs/:id/{cancel,decide}`. Mount sẵn ở `processes.mount.ts`. Quyền/khoá/máy trạng thái ở `GateService`.
import {
  CancelProcessRunRequestSchema,
  DecideProcessRunRequestSchema,
  ReassignReviewTaskRequestSchema,
  RerunProcessRunRequestSchema,
  RerunStepRequestSchema,
  ReviewDecisionRequestSchema,
  StopProcessRunRequestSchema,
} from "@ai/contracts/chat";
import { FormSubmitRequestSchema } from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseIdParam, parseJson } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { tenantIdQuery } from "../runs/runs.routes";
import { ClaimService } from "./claim.service";
import { GateService } from "./gates.service";
import { RunControlService } from "./run-control.service";

export function gatesRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new GateService(d);
  const ctl = new RunControlService(d);
  const claims = new ClaimService(d);
  const r = new Hono<AuthVars>();

  r.post("/review-tasks/:id/decision", async (c) => {
    const body = await parseJson(c, ReviewDecisionRequestSchema);
    return c.json(await svc.reviewDecision(c.var.user, c.req.param("id"), body, tenantIdQuery(c)));
  });

  // CR-127 · E2 · Nhận việc / Trả về nhóm / Giao cho người khác (task nhóm `need='one'`).
  r.post("/review-tasks/:id/claim", async (c) =>
    c.json(await claims.claim(c.var.user, parseIdParam(c), tenantIdQuery(c))),
  );
  r.post("/review-tasks/:id/release", async (c) =>
    c.json(await claims.release(c.var.user, parseIdParam(c), tenantIdQuery(c))),
  );
  r.post("/review-tasks/:id/reassign", async (c) => {
    const b = await parseJson(c, ReassignReviewTaskRequestSchema);
    return c.json(await claims.reassign(c.var.user, parseIdParam(c), b, tenantIdQuery(c)));
  });

  // CR-118 · node `form`: người điền gửi giá trị (Hub kiểm theo snapshot; cùng giá trị gửi lại ⇒ 200 cùng kết quả).
  r.post("/review-tasks/:id/form", async (c) => {
    const body = await parseJson(c, FormSubmitRequestSchema);
    return c.json(await svc.formSubmit(c.var.user, c.req.param("id"), body, tenantIdQuery(c)));
  });

  r.post("/process-runs/:id/cancel", async (c) => {
    await parseJson(c, CancelProcessRunRequestSchema);
    return c.json(await svc.cancel(c.var.user, c.req.param("id"), tenantIdQuery(c)));
  });

  r.post("/process-runs/:id/decide", async (c) => {
    const body = await parseJson(c, DecideProcessRunRequestSchema);
    return c.json(await svc.decide(c.var.user, c.req.param("id"), body, tenantIdQuery(c)));
  });

  // CR-121 · R-1 · điều khiển lượt chạy (quản trị, lý do bắt buộc). Quyền/khoá/CAS ở `RunControlService`.
  r.post("/process-runs/:id/stop", async (c) => {
    const b = await parseJson(c, StopProcessRunRequestSchema);
    return c.json(await ctl.stop(c.var.user, parseIdParam(c), b.reason, tenantIdQuery(c)));
  });

  r.post("/process-runs/:id/rerun-step", async (c) => {
    const b = await parseJson(c, RerunStepRequestSchema);
    return c.json(await ctl.rerunStep(c.var.user, parseIdParam(c), b, tenantIdQuery(c)));
  });

  // CR-122 E2b · "Chạy lại từ Nếu" cho lượt dừng "Cần xử lý" vì dữ kiện đổi sau khi rẽ (`decision.reason = facts_changed`).
  r.post("/process-runs/:id/rerun-from-if", async (c) => {
    const b = await parseJson(c, RerunProcessRunRequestSchema);
    return c.json(await ctl.rerunFromIf(c.var.user, parseIdParam(c), b.reason, tenantIdQuery(c)));
  });

  r.post("/process-runs/:id/rerun", async (c) => {
    const b = await parseJson(c, RerunProcessRunRequestSchema);
    const out = await ctl.rerun(c.var.user, parseIdParam(c), b.reason);
    return c.json(out.body, out.created ? 201 : 200);
  });

  return r;
}
