// CR-102 · com-c3 · D3 · `/pack/community/posts/:id/threads*` + `/comments`. Chủ quản: mọi luồng, chọn luồng (công ty) khi
// trả lời; đối tác: chỉ luồng công ty mình (orgId khác bị bỏ qua). Nội dung đối tác che lúc ghi; chủ quản không che (HT-55).
import {
  CreateCommentInputSchema,
  HideCommentInputSchema,
  type Thread,
  type ThreadSummary,
  UpdateCommentInputSchema,
} from "@ai/contracts/community";
import { type Context, Hono } from "hono";
import { appError } from "../../../../lib/errors";
import { parseIdParam, parseWith, readJson } from "../../../../lib/http";
import type { PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { storeComment } from "../domain/content.rules";
import * as comments from "./comment.service";
import { type CommentEvent, notifyComment } from "./comment-notify.hook";
import { type Access, accessOf, otherOrgNames } from "./community-access";
import type { CommunityDeps } from "./community-deps";
import * as threads from "./thread.service";
import { commentView, namesOf } from "./views";

const iso = (s: string) => new Date(s).toISOString();

async function readThread(
  d: CommunityDeps,
  a: Access,
  postId: string,
  org: string,
): Promise<Thread> {
  const list = await threads.comments(d.uow, a, postId, org);
  const n = namesOf(a);
  const last = list.at(-1);
  return {
    postId,
    orgId: org,
    orgName: n.orgName(org),
    count: list.length,
    ...(last ? { lastAt: iso(last.created_at) } : {}),
    comments: list.map((x) => commentView(a, n, x)),
  };
}

const evt = (
  a: Access,
  kind: CommentEvent["kind"],
  postId: string,
  threadOrg: string,
): CommentEvent => ({
  kind,
  tenantId: a.who.tenantId,
  postId,
  threadOrg,
  actorUserId: a.who.userId,
  actorOrg: a.org,
});

export function threadsRoutes(d: CommunityDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const access = (c: Context<PackGuardVars>, need: "read" | "write" = "read") =>
    accessOf(d.view, d.resolver, c, need);

  r.get("/posts/:id/threads", async (c) => {
    const a = await access(c);
    const postId = parseIdParam(c);
    const s = await threads.summaries(d.uow, a, postId);
    if (!s.post) throw appError("NOT_FOUND");
    const rows = [...s.threads];
    const must = a.org ?? s.post.author_org; // đối tác: luồng của mình; chủ quản: luồng với bên đăng (bài đối tác)
    if (must && !rows.some((t) => t.org === must)) rows.push({ org: must, count: 0, last: null });
    const n = namesOf(a);
    const out: ThreadSummary[] = rows
      .filter((t) => a.org === null || t.org === a.org)
      .map((t) => ({
        postId,
        orgId: t.org,
        orgName: n.orgName(t.org),
        count: t.count,
        ...(t.last ? { lastAt: iso(t.last) } : {}),
      }));
    return c.json(out);
  });

  r.get("/posts/:id/threads/:orgId", async (c) => {
    const a = await access(c);
    const postId = parseIdParam(c);
    const org = threads.threadOrg(a, c.req.param("orgId"));
    if (!org) throw appError("NOT_FOUND");
    return c.json(await readThread(d, a, postId, org));
  });

  r.post("/posts/:id/comments", async (c) => {
    const a = await access(c, "write");
    const postId = parseIdParam(c);
    const input = parseWith(CreateCommentInputSchema, await readJson(c));
    const text = storeComment(input.text, otherOrgNames(a));
    const org = await threads.add(d.uow, a, postId, { text, orgId: input.orgId }, d.events); // C9: chuông phát trong cùng tx
    if (text.hits.length > 0) c.header("X-Contact-Detected", "1");
    return c.json(await readThread(d, a, postId, org), 201);
  });

  const ref = (c: Context<PackGuardVars>) => ({
    postId: parseIdParam(c),
    id: parseIdParam(c, "cid"),
  });

  r.patch("/posts/:id/comments/:cid", async (c) => {
    const a = await access(c, "write");
    const x = ref(c);
    const input = parseWith(UpdateCommentInputSchema, await readJson(c));
    const org = await comments.edit(d.uow, a, x, storeComment(input.text, otherOrgNames(a)));
    await notifyComment(evt(a, "edited", x.postId, org));
    return c.json(await readThread(d, a, x.postId, org));
  });

  r.delete("/posts/:id/comments/:cid", async (c) => {
    const a = await access(c, "write");
    const x = ref(c);
    const org = await comments.remove(d.uow, a, x);
    await notifyComment(evt(a, "deleted", x.postId, org));
    return c.json(await readThread(d, a, x.postId, org));
  });

  r.post("/posts/:id/comments/:cid/hide", async (c) => {
    const a = await access(c, "write");
    const x = ref(c);
    const { hidden } = parseWith(HideCommentInputSchema, await readJson(c));
    const org = await comments.hide(d.uow, a, x, hidden);
    await notifyComment(evt(a, "hidden", x.postId, org));
    return c.json(await readThread(d, a, x.postId, org));
  });

  return r;
}
