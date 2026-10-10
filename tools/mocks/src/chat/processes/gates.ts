// HUB-FR-107 · HUB-FR-108 · mock `POST /review-tasks/:id/decision` (plan-contract §3): Đạt ⇒ stage kế, Chưa đạt ⇒ làm lại.
import { ReviewDecisionRequestSchema } from "@ai/contracts/chat";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ChatVars } from "../auth";
import { parseBody } from "../http";
import { review } from "./actions";
import { invalid, me, notFound, processError } from "./http";
import type { MockTask, ProcessState } from "./state";
import { taskDetail, viewerOf } from "./views";

/** Task mà người gọi là assignee (404 nếu không — không lộ task người khác). */
export function myTask(s: ProcessState, c: Context<ChatVars>): MockTask | null {
  const t = s.task(c.req.param("id") ?? "");
  const v = viewerOf(me(c));
  if (!t) return null;
  if (s.assignees(t).includes(v.id)) return t;
  const r = s.run(t.runId);
  return t.kind === "decision" && r && (v.admin || r.startedBy === v.id) ? t : null;
}

export function createGateRoutes(s: ProcessState): Hono<ChatVars> {
  const app = new Hono<ChatVars>();
  app.post("/review-tasks/:id/decision", async (c) => {
    const t = myTask(s, c);
    if (!t) return notFound(c);
    const b = await parseBody(c, ReviewDecisionRequestSchema);
    if (!b.ok) return invalid(c, b);
    if (t.kind !== "review") return processError(c, "TASK_KIND_MISMATCH");
    if (t.status !== "open") return processError(c, "REVIEW_TASK_CLOSED");
    if (b.data.result === "fail" && !b.data.feedback) return processError(c, "FEEDBACK_REQUIRED");
    review(s, t, me(c), b.data);
    return c.json(taskDetail(s, viewerOf(me(c)), t));
  });
  return app;
}
