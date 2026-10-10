// HUB-FR-110 · HUB-FR-111 · mock `POST /review-tasks/:id/{answer,forward}` (plan-contract §3, thứ tự lỗi như bảng).
import {
  FORWARD_CHAIN_MAX,
  ForwardReviewTaskRequestSchema,
  ReviewAnswerRequestSchema,
} from "@ai/contracts/chat";
import { Hono } from "hono";
import type { ChatVars } from "../auth";
import { parseBody } from "../http";
import { findUserById } from "../users";
import { answer, forward } from "./actions";
import { myTask } from "./gates";
import { invalid, me, notFound, processError } from "./http";
import type { MockTask, ProcessState } from "./state";
import { taskDetail, viewerOf } from "./views";

function forwardError(s: ProcessState, t: MockTask, by: string, to: string) {
  if (t.kind === "decision") return "TASK_KIND_MISMATCH" as const;
  if (t.status !== "open") return "REVIEW_TASK_CLOSED" as const;
  if (t.forwards.length >= FORWARD_CHAIN_MAX) return "FORWARD_LIMIT" as const;
  if (t.kind === "review" && !s.groupMembers(t.groupId).includes(to))
    return "FORWARD_OUT_OF_GROUP" as const;
  const u = findUserById(to);
  const bad = !u || u.locked || u.tenant.key !== "acme" || to === by || s.assignees(t).includes(to);
  return bad ? ("FORWARD_TARGET_INVALID" as const) : null;
}

export function createAskRoutes(s: ProcessState): Hono<ChatVars> {
  const app = new Hono<ChatVars>();
  app.post("/review-tasks/:id/answer", async (c) => {
    const t = myTask(s, c);
    if (!t) return notFound(c);
    const b = await parseBody(c, ReviewAnswerRequestSchema);
    if (!b.ok) return invalid(c, b);
    if (t.kind !== "ask") return processError(c, "TASK_KIND_MISMATCH");
    if (t.status !== "open") return processError(c, "REVIEW_TASK_CLOSED");
    answer(s, t, me(c), b.data);
    return c.json(taskDetail(s, viewerOf(me(c)), t));
  });
  app.post("/review-tasks/:id/forward", async (c) => {
    const t = myTask(s, c);
    if (!t) return notFound(c);
    const b = await parseBody(c, ForwardReviewTaskRequestSchema);
    if (!b.ok) return invalid(c, b);
    const err = forwardError(s, t, me(c), b.data.to_user_id);
    if (err) return processError(c, err);
    forward(s, t, { by: me(c), to: b.data.to_user_id, note: b.data.note || null });
    return c.json(taskDetail(s, viewerOf(me(c)), t));
  });
  return app;
}
