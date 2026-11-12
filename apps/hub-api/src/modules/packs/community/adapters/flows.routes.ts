// CR-120 · cr120-community-flows · REST của 3 khe Community (chạy KHÔNG phụ thuộc cờ flow runtime):
//   GET  /moderation/queue            (Admin chủ quản)  · GET /moderation/mine (bài của tôi đang/đã duyệt)
//   POST /moderation/:id/decide       {action approve|reject, taskId?, feedback?}
//   POST /join-requests               (đối tác: form xin tham gia) · GET /join-requests[?pending=1]
//   POST /join-requests/:id/decide    (tenant admin)
//   POST /posts/:id/report {reason}   (mọi người xem thấy bài; trùng ⇒ 409) · GET /reports[?pending=1]
//   POST /reports/:id/decide          {action hide|warn|dismiss}
import {
  FlowDecideInputSchema,
  type FlowNav,
  type JoinRequest,
  JoinRequestInputSchema,
  type ModerationItem,
  type Report,
  ReportInputSchema,
} from "@ai/contracts/community";
import { type Context, Hono } from "hono";
import { parseIdParam, parseWith, readJson } from "../../../../lib/http";
import type { PackGuardVars } from "../../kit/public";
import { awaitingReview } from "../domain/flow.rules";
import type { JoinRow, ModPostRow, ReportRow } from "../domain/flow-rows.types";
import { accessOf } from "./community-access";
import type { CommunityDeps } from "./community-deps";
import * as svc from "./flows.service";

const modItem = (r: ModPostRow, now: number): ModerationItem => ({
  id: r.id,
  taskId: r.mod_task_id,
  moderation: r.moderation,
  screen: r.mod_screen,
  reason: r.mod_reason,
  awaitingReview: awaitingReview(r, now),
  type: r.type,
  title: r.title,
  authorName: r.author_name,
  createdAt: r.created_at,
  decidedBy: r.decided_name,
  feedback: r.feedback,
});
const joinItem = (r: JoinRow): JoinRequest => ({
  id: r.id,
  taskId: r.task_id,
  status: r.status,
  company: r.company,
  contact: r.contact,
  email: r.email,
  reason: r.reason,
  labels: r.labels,
  createdAt: r.created_at,
  decidedBy: r.decided_name,
  feedback: r.feedback,
});
const reportItem = (r: ReportRow): Report => ({
  id: r.id,
  taskId: r.task_id,
  postId: r.post_id,
  postTitle: r.post_title,
  reason: r.reason,
  status: r.status,
  triage: r.triage,
  kind: r.triage_kind as Report["kind"],
  level: r.triage_level as Report["level"],
  action: r.action,
  createdAt: r.created_at,
  decidedBy: r.decided_name,
});

export function flowsRoutes(d: CommunityDeps, f: svc.FlowDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const access = (c: Context<PackGuardVars>, need: "read" | "write" = "read") =>
    accessOf(d.view, d.resolver, c, need);
  const now = () => (f.now ? f.now() : Date.now());
  const pending = (c: Context<PackGuardVars>) => c.req.query("pending") === "1";
  const decideBody = async (c: Context<PackGuardVars>) =>
    parseWith(FlowDecideInputSchema, await readJson(c));

  r.get("/flows/nav", async (c) => {
    const a = await access(c);
    const rev = svc.reviewer(a);
    const on = await svc.moderationEnabled(f, a.who.tenantId);
    const nav: FlowNav = {
      moderationQueue: rev && on,
      moderationOn: on,
      joinSubmit: a.org !== null,
      joinReview: svc.joinReviewer(a),
      reports: rev,
    };
    return c.json(nav);
  });
  r.get("/moderation/queue", async (c) => {
    const rows = await svc.modQueue(f, await access(c));
    return c.json({ items: rows.map((x) => modItem(x, now())) });
  });
  r.get("/moderation/mine", async (c) => {
    const rows = await svc.myModeration(f, await access(c));
    return c.json({ items: rows.map((x) => modItem(x, now())) });
  });
  r.post("/moderation/:id/decide", async (c) => {
    const a = await access(c, "write");
    const row = await svc.decideModeration(f, a, parseIdParam(c), await decideBody(c));
    return c.json(modItem(row, now()));
  });

  r.post("/join-requests", async (c) => {
    const a = await access(c, "write");
    const input = parseWith(JoinRequestInputSchema, await readJson(c));
    return c.json(joinItem(await svc.createJoin(f, a, input)), 201);
  });
  r.get("/join-requests", async (c) => {
    const rows = await svc.joinList(f, await access(c), pending(c));
    return c.json({ items: rows.map(joinItem) });
  });
  r.post("/join-requests/:id/decide", async (c) => {
    const a = await access(c, "write");
    return c.json(joinItem(await svc.decideJoin(f, a, parseIdParam(c), await decideBody(c))));
  });

  r.post("/posts/:id/report", async (c) => {
    const a = await access(c, "write");
    const id = parseIdParam(c);
    const { reason } = parseWith(ReportInputSchema, await readJson(c));
    return c.json(reportItem(await svc.createReport(f, a, id, reason)), 201);
  });
  r.get("/reports", async (c) => {
    const rows = await svc.reportList(f, await access(c), pending(c));
    return c.json({ items: rows.map(reportItem) });
  });
  r.post("/reports/:id/decide", async (c) => {
    const a = await access(c, "write");
    return c.json(reportItem(await svc.decideReport(f, a, parseIdParam(c), await decideBody(c))));
  });
  return r;
}
