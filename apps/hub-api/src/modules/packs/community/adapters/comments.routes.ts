// CR-129 · `/pack/community/posts/:id/comments*` + `/mentionables` — bình luận phẳng theo bài (không còn luồng theo công ty).
// Ai thấy bình luận do RLS; chủ quản nhắc (@) công ty đối tác bằng `mentions` (≤ 10, phải thuộc `mentionables` của bài ⇒ 422
// `MENTION_NOT_ALLOWED`). Nội dung đối tác che lúc ghi; chủ quản không che (HT-55).
import {
  CommentListQuerySchema,
  CreateCommentInputSchema,
  HideCommentInputSchema,
  MentionablesQuerySchema,
  UpdateCommentInputSchema,
} from "@ai/contracts/community";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { appError } from "../../../../lib/errors";
import { parseIdParam, parseWith, readJson, withoutScopeKeys } from "../../../../lib/http";
import type { PackGuardVars } from "../../kit/public";
import { storeComment } from "../domain/content.rules";
import * as comments from "./comment.service";
import * as list from "./comment-list.service";
import { accessOf, otherOrgNames } from "./community-access";
import type { CommunityDeps } from "./community-deps";
import { commentView, namesOf } from "./views";

const UUID = z.uuid();
const cursorFor = (at: string, id: string) => Buffer.from(`${at}|${id}`).toString("base64url");

function cursorOf(s: string | undefined): { at: string; id: string } | null {
  if (!s) return null;
  const [at, id] = Buffer.from(s, "base64url").toString("utf8").split("|");
  if (!at || Number.isNaN(Date.parse(at)) || !UUID.safeParse(id).success)
    throw appError("VALIDATION_ERROR");
  return { at, id: id as string };
}

/** Query số (`limit`) đến dạng chuỗi ⇒ ép số trước khi kiểm zod. */
function query<S extends z.ZodType>(c: Context<PackGuardVars>, schema: S): z.output<S> {
  const raw = withoutScopeKeys(c.req.query());
  return parseWith(schema, {
    ...raw,
    ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
  });
}

export function commentsRoutes(d: CommunityDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const access = (c: Context<PackGuardVars>, need: "read" | "write" = "read") =>
    accessOf(d.view, d.resolver, c, need);

  r.get("/posts/:id/comments", async (c) => {
    const a = await access(c);
    const postId = parseIdParam(c);
    const q = query(c, CommentListQuerySchema);
    const { rows, more } = await list.list(d.uow, a, postId, {
      cursor: cursorOf(q.cursor),
      limit: q.limit,
    });
    const n = namesOf(a);
    const last = rows.at(-1);
    return c.json({
      comments: rows.map((x) => commentView(a, n, x)),
      ...(more && last ? { nextCursor: cursorFor(last.created_at, last.id) } : {}),
    });
  });

  r.get("/posts/:id/mentionables", async (c) => {
    const a = await access(c);
    const postId = parseIdParam(c);
    const q = query(c, MentionablesQuerySchema);
    const out = await list.mentionables(d.uow, a, postId, { q: q.q, limit: q.limit });
    return c.json(out.map((o) => ({ orgId: o.id, name: o.name })));
  });

  r.post("/posts/:id/comments", async (c) => {
    const a = await access(c, "write");
    const postId = parseIdParam(c);
    const input = parseWith(CreateCommentInputSchema, await readJson(c));
    const text = storeComment(input.text, otherOrgNames(a));
    const row = await list.add(d.uow, a, postId, { text, mentions: input.mentions }, d.events); // C9: chuông SAU commit
    if (text.hits.length > 0) c.header("X-Contact-Detected", "1");
    return c.json(commentView(a, namesOf(a), row), 201);
  });

  const ref = (c: Context<PackGuardVars>) => ({
    postId: parseIdParam(c),
    id: parseIdParam(c, "cid"),
  });

  r.patch("/posts/:id/comments/:cid", async (c) => {
    const a = await access(c, "write");
    const x = ref(c);
    const input = parseWith(UpdateCommentInputSchema, await readJson(c));
    const row = await comments.edit(d.uow, a, x, storeComment(input.text, otherOrgNames(a)));
    return c.json(commentView(a, namesOf(a), row));
  });

  r.delete("/posts/:id/comments/:cid", async (c) => {
    const a = await access(c, "write");
    await comments.remove(d.uow, a, ref(c));
    return c.body(null, 204);
  });

  r.post("/posts/:id/comments/:cid/hide", async (c) => {
    const a = await access(c, "write");
    const x = ref(c);
    const { hidden } = parseWith(HideCommentInputSchema, await readJson(c));
    return c.json(commentView(a, namesOf(a), await comments.hide(d.uow, a, x, hidden)));
  });

  return r;
}
