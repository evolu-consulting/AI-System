// HUB-FR-112 · HUB-FR-114 · mock "Chờ tôi kiểm" (`/me/review-tasks`) + DM "Quy trình" (`/me/process-inbox*`).
import {
  MarkProcessInboxReadRequestSchema,
  OPEN_TASKS_COUNT_MAX,
  PROCESS_SYSTEM_SENDER,
  ProcessInboxQuerySchema,
  ReviewTaskListQuerySchema,
} from "@ai/contracts/chat";
import { Hono } from "hono";
import type { ChatVars } from "../auth";
import { parseBody, parseWith } from "../http";
import { invalid, me, notFound } from "./http";
import { type MockRun, type ProcessState, userRef } from "./state";
import { canAct, taskDetail, viewerOf } from "./views";

export function createReviewTaskRoutes(s: ProcessState): Hono<ChatVars> {
  const app = new Hono<ChatVars>();
  app.get("/me/review-tasks", (c) => {
    const q = parseWith(ReviewTaskListQuerySchema, c.req.query());
    if (!q.ok) return invalid(c, q);
    const v = viewerOf(me(c));
    const mine = s.tasks.filter((t) => s.assignees(t).includes(v.id));
    const open = mine.filter((t) => t.status === "open" && canAct(s, v, t));
    const items = mine
      .filter((t) => t.status === q.data.status)
      .slice(0, q.data.limit)
      .map((t) => {
        const r = s.run(t.runId) as MockRun;
        return {
          task: taskDetail(s, v, t),
          process_run: {
            id: r.id,
            process: { key: r.def.key, name: r.def.name },
            status: r.status,
            started_by: userRef(r.startedBy),
          },
        };
      });
    return c.json({
      items,
      open_count: Math.min(open.length, OPEN_TASKS_COUNT_MAX),
      next_cursor: null,
    });
  });
  return app;
}

export function createInboxRoutes(s: ProcessState): Hono<ChatVars> {
  const app = new Hono<ChatVars>();
  app.get("/me/process-inbox", (c) => {
    const q = parseWith(ProcessInboxQuerySchema, c.req.query());
    if (!q.ok) return invalid(c, q);
    const owner = me(c);
    const items = s.notices
      .filter((n) => n.owner === owner)
      .reverse()
      .slice(0, q.data.limit)
      .map(({ owner: _o, ...n }) => n);
    return c.json({
      sender: PROCESS_SYSTEM_SENDER,
      items,
      unread: s.unread(owner),
      next_cursor: null,
    });
  });

  app.post("/me/process-inbox/read", async (c) => {
    const b = await parseBody(c, MarkProcessInboxReadRequestSchema);
    if (!b.ok) return invalid(c, b);
    const owner = me(c);
    const mine = s.notices.filter((n) => n.owner === owner);
    const idx = mine.findIndex((n) => n.id === b.data.up_to_id);
    if (idx < 0) return notFound(c);
    for (const n of mine.slice(0, idx + 1)) n.read = true;
    return c.json({ unread: s.unread(owner) });
  });

  return app;
}
