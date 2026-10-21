// gap-a1 · route trang chi tiết HĐ (mount dưới `/pack/contracts`): `GET /contracts/:id/history` (read, theo luật thấy của người gọi),
// `GET /assignees` + `PUT /contracts/:id/owner` + `PUT /contracts/:id/commission` + `POST /contracts/:id/summary` (write; AI có trần
// thao tác theo tenant/ngày). Guard TRƯỚC đọc thân/tham số (viewer ⇒ 403, 0 SQL); `:id` sai dạng ⇒ 400; HĐ không thấy / tenant khác ⇒ 404.
import {
  CONTRACT_ERRORS,
  CommissionEditRequestSchema,
  HISTORY_MAX,
  MANAGE_ERRORS,
  OwnerAssignRequestSchema,
} from "@ai/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import type { PackWho } from "../../kit/application/ports";
import type {
  AssignOwner,
  EditCommission,
  GetHistory,
  Summarize,
} from "../application/manage.usecase";

const KEY = "contracts";

export type ManageRoutesDeps = {
  history: GetHistory;
  assignees: (who: PackWho) => Promise<{ id: string; name: string }[]>;
  assign: AssignOwner;
  commission: EditCommission;
  summarize: Summarize;
  quota?: (tenantId: string) => Promise<void>;
};

const whoOf = (u: { tenantId: string; userId: string }): PackWho => ({
  tenantId: u.tenantId,
  userId: u.userId,
});
const idOf = (p: string | undefined) => parseWith(z.uuid(), p);

export function manageRoutes(view: PackAccessView, d: ManageRoutesDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");

  r.get("/contracts/:id/history", read, async (c) => {
    const items = await d.history(whoOf(c.get("user")), idOf(c.req.param("id")), HISTORY_MAX);
    if (!items) throw appError("NOT_FOUND");
    return c.json({ items });
  });

  r.get("/assignees", write, async (c) =>
    c.json({ items: await d.assignees(whoOf(c.get("user"))) }),
  );

  r.put("/contracts/:id/owner", write, async (c) => {
    const id = idOf(c.req.param("id"));
    const body = parseWith(OwnerAssignRequestSchema, await readJson(c));
    const out = await d.assign(whoOf(c.get("user")), id, body.owner_user_id);
    if (out.kind === "not_found") throw appError("NOT_FOUND");
    if (out.kind === "owner_invalid")
      throw new AppError("OWNER_INVALID", MANAGE_ERRORS.OWNER_INVALID, "Assignee has no access");
    return c.json({ id, owner_user_id: body.owner_user_id });
  });

  r.put("/contracts/:id/commission", write, async (c) => {
    const id = idOf(c.req.param("id"));
    const body = parseWith(CommissionEditRequestSchema, await readJson(c));
    const out = await d.commission(whoOf(c.get("user")), id, body);
    if (out.kind === "ok")
      return c.json({ id, version: out.version, commission_pct: out.commission_pct });
    if (out.kind === "not_found") throw appError("NOT_FOUND");
    if (out.kind === "not_allowed")
      throw new AppError(
        "COMMISSION_NOT_ALLOWED",
        MANAGE_ERRORS.COMMISSION_NOT_ALLOWED,
        "Commission only for a read referral contract",
      );
    throw new AppError("CONTRACT_STALE", CONTRACT_ERRORS.CONTRACT_STALE, "Contract was modified", {
      current: out.current,
      updated_at: out.updated_at,
    });
  });

  r.post("/contracts/:id/summary", write, async (c) => {
    const id = idOf(c.req.param("id"));
    await d.quota?.(c.get("user").tenantId);
    const out = await d.summarize(whoOf(c.get("user")), id);
    if (out.kind === "ok") return c.json({ id, summary: out.summary });
    if (out.kind === "not_found") throw appError("NOT_FOUND");
    if (out.kind === "not_allowed")
      throw new AppError(
        "SUMMARY_NOT_ALLOWED",
        MANAGE_ERRORS.SUMMARY_NOT_ALLOWED,
        "Contract has a summary already or nothing to summarise",
      );
    if (out.kind === "ai_cap")
      throw new AppError("AI_CAP_EXCEEDED", 429, "AI daily token cap reached");
    throw new AppError(
      "SUMMARY_UNAVAILABLE",
      MANAGE_ERRORS.SUMMARY_UNAVAILABLE,
      "Summary could not be generated",
    );
  });
  return r;
}
