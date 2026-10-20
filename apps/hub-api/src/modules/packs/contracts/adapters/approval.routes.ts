// HD-FR-34 · HD-FR-36 · HD-FR-37 · HD3 spec §3 · M3-decouple: `GET|POST /pack/contracts/contracts/:id/approval`,
// `GET|PUT /pack/contracts/approval-settings`. Guard gói TRƯỚC đọc thân (viewer ghi ⇒ 403, 0 SQL); `:id` sai dạng ⇒ 400; HĐ tenant
// khác ⇒ 404. Quyền bước duyệt do máy trạng thái của gói quyết (Group duyệt, người bắt đầu ở cấp 2) — mã lỗi giữ như HD3.
import {
  ApprovalActionRequestSchema,
  ApprovalSettingsPatchSchema,
  CONTRACT_APPROVAL_ERRORS,
  CONTRACT_ERRORS,
} from "@ai/contracts";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import type {
  ApprovalAction,
  actApproval,
  getApproval,
  readApprovalSettings,
  saveApprovalSettings,
} from "../application/approval.usecase";
import type { ApprovalSettings } from "../domain/approval-def.rules";
import type { ApprovalErrorCode } from "../domain/approval-machine.rules";

const KEY = "contracts";
export type ApprovalRoutesDeps = {
  get: ReturnType<typeof getApproval>;
  act: ReturnType<typeof actApproval>;
  readSettings: ReturnType<typeof readApprovalSettings>;
  saveSettings: ReturnType<typeof saveApprovalSettings>;
};

const who = (u: AuthUser) => ({ userId: u.userId, tenantId: u.tenantId });
const settingsOut = (s: ApprovalSettings) => ({
  threshold: s.threshold,
  level1_group_key: s.level1GroupKey,
  level2_group_key: s.level2GroupKey,
});

const ERRORS: Record<ApprovalErrorCode, [ContentfulStatusCode, string]> = {
  APPROVAL_NOT_OPEN: [CONTRACT_APPROVAL_ERRORS.APPROVAL_NOT_OPEN, "No approval step is open"],
  NOT_REVIEWER: [CONTRACT_APPROVAL_ERRORS.NOT_REVIEWER, "Not a reviewer of this step"],
  STARTER_CANNOT_REVIEW: [403, "The starter cannot review this step"],
  FEEDBACK_REQUIRED: [422, "Feedback is required"],
};
const approvalError = (code: ApprovalErrorCode) => {
  const [status, msg] = ERRORS[code];
  return new AppError(code, status, msg);
};

export function approvalRoutes(view: PackAccessView, d: ApprovalRoutesDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  const admin = packGuard(view, KEY, "admin");
  r.get("/contracts/:id/approval", read, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const out = await d.get(who(c.get("user")), id);
    if (!out) throw appError("NOT_FOUND");
    return c.json(out);
  });
  r.post("/contracts/:id/approval", write, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const b = parseWith(ApprovalActionRequestSchema, await readJson(c)) as ApprovalAction;
    // Trích lại tốn AI (#221): quota + AI sẵn sàng kiểm trong use case SAU `decide` (review B #27/#28).
    const out = await d.act(who(c.get("user")), id, b);
    if (out === "not_found") throw appError("NOT_FOUND");
    if (out === "unavailable")
      throw new AppError(
        "AGENT_UNAVAILABLE",
        CONTRACT_ERRORS.AGENT_UNAVAILABLE,
        "Extraction agent unavailable",
      );
    if ("error" in out) throw approvalError(out.error);
    return c.json(out);
  });
  r.get("/approval-settings", read, async (c) =>
    c.json(settingsOut(await d.readSettings(who(c.get("user"))))),
  );
  r.put("/approval-settings", admin, async (c) => {
    const p = parseWith(ApprovalSettingsPatchSchema, await readJson(c));
    const u = who(c.get("user"));
    const cur = await d.readSettings(u);
    const next: ApprovalSettings = {
      threshold: p.threshold ?? cur.threshold,
      level1GroupKey: p.level1_group_key ?? cur.level1GroupKey,
      level2GroupKey: p.level2_group_key ?? cur.level2GroupKey,
    };
    const out = await d.saveSettings(u, next);
    if (out === "group_missing")
      throw new AppError(
        "APPROVAL_GROUP_MISSING",
        CONTRACT_APPROVAL_ERRORS.APPROVAL_GROUP_MISSING,
        "Approval group not found",
      );
    return c.json(settingsOut(out));
  });
  return r;
}
