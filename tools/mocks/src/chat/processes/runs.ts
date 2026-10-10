// HUB-FR-105…109 · HUB-FR-117 · mock `GET /processes`, `/process-runs*` (plan-contract §3): view theo persona Bearer,
// cancel/decide đổi trạng thái fixture + phát sự kiện.
import {
  CreateProcessRunRequestSchema,
  DecideProcessRunRequestSchema,
  PROCESS_RUN_ID_HEADER,
  PROCESS_RUNS_PER_TENANT,
  ProcessRunListQuerySchema,
  RETRY_AFTER_HEADER,
  TOO_MANY_PROCESS_RUNS_RETRY_AFTER_S,
} from "@ai/contracts/chat";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ChatVars } from "../auth";
import { parseBody, parseWith } from "../http";
import { decide } from "./actions";
import { PA_FIX, PROCESSES, processByKey } from "./fixtures";
import { forbidden, invalid, me, notFound, processError } from "./http";
import { summaryUsage } from "./seed";
import { isActive, type ProcessState } from "./state";
import { access, canCancel, runView, summary, viewerOf } from "./views";

/** Fixture có sẵn 4 run đang chạy; mock cho bắt đầu thêm đúng PROCESS_RUNS_PER_TENANT run rồi 429. */
const SEED_ACTIVE = 4;
const suggest = (typed: string) =>
  PROCESSES.map((p) => p.key)
    .filter((k) => k.startsWith(typed.slice(0, 2)))
    .slice(0, 3);

function catalog(c: Context<ChatVars>) {
  const items = PROCESSES.map((p) => ({
    key: p.key,
    name: p.name,
    description: p.description,
    input_hint: p.input_hint,
    stage_count: p.stages.length,
  }));
  return c.json({ items: items.sort((a, b) => a.name.localeCompare(b.name)) });
}

async function create(s: ProcessState, c: Context<ChatVars>) {
  const b = await parseBody(c, CreateProcessRunRequestSchema);
  if (!b.ok) return invalid(c, b);
  const def = processByKey(b.data.process_key);
  if (!def)
    return processError(c, "PROCESS_NOT_FOUND", { suggestions: suggest(b.data.process_key) });
  const o = b.data.origin;
  if (o.kind === "room" && !(o.room_id === PA_FIX.room && s.roomMembers().includes(me(c))))
    return notFound(c);
  if (s.runs.filter((r) => isActive(r.status)).length >= PROCESS_RUNS_PER_TENANT + SEED_ACTIVE) {
    c.header(RETRY_AFTER_HEADER, String(TOO_MANY_PROCESS_RUNS_RETRY_AFTER_S));
    return processError(c, "TOO_MANY_PROCESS_RUNS");
  }
  const r = s.createRun({
    def,
    startedBy: me(c),
    input: b.data.input,
    roomId: o.kind === "room" ? o.room_id : null,
  });
  c.header(PROCESS_RUN_ID_HEADER, r.id);
  return c.json(summary(r), 201);
}

function list(s: ProcessState, c: Context<ChatVars>) {
  const q = parseWith(ProcessRunListQuerySchema, c.req.query());
  if (!q.ok) return invalid(c, q);
  const v = viewerOf(me(c));
  if (q.data.scope === "tenant" && !v.admin) return forbidden(c);
  if (q.data.room_id && q.data.room_id !== PA_FIX.room) return notFound(c);
  const items = s.runs
    .filter((r) =>
      q.data.scope === "tenant"
        ? true
        : q.data.room_id
          ? r.roomId === q.data.room_id
          : r.startedBy === v.id,
    )
    .filter((r) => access(s, v, r) !== null)
    .filter((r) => !q.data.process_key || r.def.key === q.data.process_key)
    .filter((r) => !q.data.status || r.status === q.data.status)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, q.data.limit)
    .map(summary);
  return c.json({ items, next_cursor: null });
}

function getRun(s: ProcessState, c: Context<ChatVars>) {
  const r = s.run(c.req.param("id") ?? "");
  const view = r ? runView(s, viewerOf(me(c)), r) : null;
  return view ? c.json(view) : notFound(c);
}

function getOutput(s: ProcessState, c: Context<ChatVars>) {
  const r = s.run(c.req.param("id") ?? "");
  const v = viewerOf(me(c));
  const a = access(s, v, r);
  const out = r?.stages.flatMap((st) => st.outputs).find((o) => o.id === c.req.param("oid"));
  if (!r || !a || !out) return notFound(c);
  const mine = s.tasks.some(
    (t) => t.runId === r.id && t.output?.id === out.id && s.assignees(t).includes(v.id),
  );
  if (a === "task" && r.startedBy !== v.id && !mine) return notFound(c);
  return c.json(out);
}

function getUsage(s: ProcessState, c: Context<ChatVars>) {
  const r = s.run(c.req.param("id") ?? "");
  const a = access(s, viewerOf(me(c)), r);
  if (!r?.usage || !a) return notFound(c);
  return c.json(a === "full" ? r.usage : summaryUsage(r.usage));
}

function cancel(s: ProcessState, c: Context<ChatVars>) {
  const r = s.run(c.req.param("id") ?? "");
  const v = viewerOf(me(c));
  if (!r || !access(s, v, r)) return notFound(c);
  if (!(v.admin || r.startedBy === v.id)) return processError(c, "NOT_PROCESS_DECIDER");
  if (!canCancel(v, r)) return processError(c, "PROCESS_RUN_STATE");
  s.finish(r, "cancelled", v.id);
  return c.json(summary(r));
}

async function decideRun(s: ProcessState, c: Context<ChatVars>) {
  const r = s.run(c.req.param("id") ?? "");
  const v = viewerOf(me(c));
  const view = r ? runView(s, v, r) : null;
  if (!r || !view) return notFound(c);
  const b = await parseBody(c, DecideProcessRunRequestSchema);
  if (!b.ok) return invalid(c, b);
  if (r.status !== "needs_decision") return processError(c, "PROCESS_RUN_STATE");
  if (view.access === "full" && !view.decision?.can_decide)
    return processError(c, "NOT_PROCESS_DECIDER");
  if (b.data.option === "use_current" && s.stage(r).outputs.length === 0)
    return processError(c, "NO_OUTPUT");
  decide(s, r, v.id, b.data.option);
  return c.json(runView(s, v, r));
}

export function createRunRoutes(s: ProcessState): Hono<ChatVars> {
  const app = new Hono<ChatVars>();
  app.get("/processes", catalog);
  app.post("/process-runs", (c) => create(s, c));
  app.get("/process-runs", (c) => list(s, c));
  app.get("/process-runs/:id", (c) => getRun(s, c));
  app.get("/process-runs/:id/outputs/:oid", (c) => getOutput(s, c));
  app.get("/process-runs/:id/usage", (c) => getUsage(s, c));
  app.post("/process-runs/:id/cancel", (c) => cancel(s, c));
  app.post("/process-runs/:id/decide", (c) => decideRun(s, c));
  return app;
}
