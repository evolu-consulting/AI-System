// CR-118 · UW-FR-10/11/14 · ADR-0035 · route flow chung của kit, gắn dưới `/pack/<k>` (chỉ khi cờ `HUB_FLOW_RUNTIME=on`):
//   GET  /flow/:slot/:ref                              → FlowView (packGuard `read`)
//   POST /flow/:slot/:ref/tasks/:id/actions/:action    → { view } (packGuard `write`; quyền bước = canAct của engine/gói)
//   POST /flow/:slot/summary {refs ≤ 100}              → FlowSummary (packGuard `read`; số SQL cố định mỗi lô)
// Guard gói TRƯỚC đọc thân. Đối tác ⇒ 403 (tường lửa ngoài cùng đã chặn `/pack/contracts`; ở đây chặn lần nữa cho mọi gói).
import {
  FlowActionRequestSchema,
  FlowSlotKeySchema,
  FlowSummaryRequestSchema,
} from "@ai/contracts/flow";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import type { FlowDenied, FlowRuntime } from "../application/flow.ports";
import type { PackWho } from "../application/ports";
import { type PackAccessView, type PackGuardVars, packGuard } from "./pack-guard.middleware";

const who = (u: AuthUser): PackWho => ({
  userId: u.userId,
  tenantId: u.tenantId,
  ...(u.userKind ? { userKind: u.userKind } : {}),
});
const Action = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
const Ref = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

function denied<T>(out: T | FlowDenied): T {
  if (out === "forbidden") throw new AppError("FORBIDDEN", 403, "Forbidden");
  if (out === "no_slot") throw appError("NOT_FOUND");
  return out as T;
}

export function flowRoutes(
  view: PackAccessView,
  packKey: string,
  rt: FlowRuntime,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, packKey, "read");
  const write = packGuard(view, packKey, "write");
  r.post("/flow/:slot/summary", read, async (c) => {
    const slot = parseWith(FlowSlotKeySchema, c.req.param("slot"));
    const b = parseWith(FlowSummaryRequestSchema, await readJson(c));
    const items = denied(await rt.summary(who(c.get("user")), slot, b.refs));
    return c.json({ slot, items });
  });
  r.get("/flow/:slot/:ref", read, async (c) => {
    const slot = parseWith(FlowSlotKeySchema, c.req.param("slot"));
    const ref = parseWith(Ref, c.req.param("ref"));
    const out = denied(await rt.view(who(c.get("user")), slot, ref));
    if (!out) throw appError("NOT_FOUND");
    return c.json(out);
  });
  r.post("/flow/:slot/:ref/tasks/:id/actions/:action", write, async (c) => {
    const slot = parseWith(FlowSlotKeySchema, c.req.param("slot"));
    const ref = parseWith(Ref, c.req.param("ref"));
    const taskId = parseWith(z.uuid(), c.req.param("id"));
    const action = parseWith(Action, c.req.param("action"));
    const b = parseWith(FlowActionRequestSchema, await readJson(c));
    const out = denied(await rt.act(who(c.get("user")), slot, ref, taskId, action, b));
    if (out === "not_found") throw appError("NOT_FOUND");
    if ("error" in out) throw new AppError(out.error.code, out.error.status, out.error.code);
    return c.json(out);
  });
  return r;
}
