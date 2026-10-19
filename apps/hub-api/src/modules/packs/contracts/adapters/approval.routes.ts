// HD-FR-34 · HD-FR-36 · HD-FR-37 · HD3 spec §3: `GET|POST /pack/contracts/contracts/:id/approval`,
// `GET|PUT /pack/contracts/approval-settings`. Guard gói TRƯỚC đọc thân (viewer ghi ⇒ 403, 0 SQL); `:id` sai dạng ⇒ 400; HĐ tenant
// khác ⇒ 404. Quyền bước duyệt do engine quyết (Group duyệt, `exclude_starter`); engine trả 404 khi không thuộc Group ⇒ 403
// `NOT_REVIEWER` (HĐ đã thấy được qua RLS, không lộ gì thêm).
import {
  ApprovalActionRequestSchema,
  ApprovalSettingsPatchSchema,
  CONTRACT_APPROVAL_ERRORS,
} from "@ai/contracts";
import { Hono } from "hono";
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
  ContractApproval,
  getApproval,
  readApprovalSettings,
  saveApprovalSettings,
} from "../application/approval.usecase";
import type { ApprovalSettings } from "../domain/approval-def.rules";
import type { ActionQuota } from "./action-quota";

const KEY = "contracts";
export type ApprovalRoutesDeps = {
  get: ReturnType<typeof getApproval>;
  act: ReturnType<typeof actApproval>;
  readSettings: ReturnType<typeof readApprovalSettings>;
  saveSettings: ReturnType<typeof saveApprovalSettings>;
  quota: ActionQuota;
};

const caller = (u: AuthUser) => ({ userId: u.userId, tenantId: u.tenantId, role: u.role });
const notOpen = () =>
  new AppError(
    "APPROVAL_NOT_OPEN",
    CONTRACT_APPROVAL_ERRORS.APPROVAL_NOT_OPEN,
    "No approval step is open",
  );
const settingsOut = (s: ApprovalSettings) => ({
  threshold: s.threshold,
  level1_group_key: s.level1GroupKey,
  level2_group_key: s.level2GroupKey,
});

/** Engine báo "không thấy task" (không thuộc Group) ⇒ 403 `NOT_REVIEWER`; lỗi khác giữ nguyên. */
async function asReviewer<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError && e.status === 404)
      throw new AppError(
        "NOT_REVIEWER",
        CONTRACT_APPROVAL_ERRORS.NOT_REVIEWER,
        "Not a reviewer of this step",
      );
    throw e;
  }
}

export function approvalRoutes(view: PackAccessView, d: ApprovalRoutesDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  const admin = packGuard(view, KEY, "admin");
  r.get("/contracts/:id/approval", read, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const out = await d.get(caller(c.get("user")), id);
    if (!out) throw appError("NOT_FOUND");
    return c.json(out satisfies ContractApproval);
  });
  r.post("/contracts/:id/approval", write, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const b = parseWith(ApprovalActionRequestSchema, await readJson(c)) as ApprovalAction;
    const u = caller(c.get("user"));
    if (b.action === "redo") await d.quota(u.tenantId); // Trích lại tốn AI (#221)
    const out = await asReviewer(() => d.act(u, id, b));
    if (out === "not_found") throw appError("NOT_FOUND");
    if (out === "not_open") throw notOpen();
    return c.json(out);
  });
  r.get("/approval-settings", read, async (c) =>
    c.json(settingsOut(await d.readSettings(caller(c.get("user"))))),
  );
  r.put("/approval-settings", admin, async (c) => {
    const p = parseWith(ApprovalSettingsPatchSchema, await readJson(c));
    const u = caller(c.get("user"));
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
    if (out === "engine_off")
      throw new AppError("PROCESS_ENGINE_OFF", 503, "Process engine is off");
    return c.json(settingsOut(out));
  });
  return r;
}
