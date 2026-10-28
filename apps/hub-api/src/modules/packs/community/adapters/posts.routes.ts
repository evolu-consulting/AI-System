// CR-102 · com-c3 · `/pack/community/feed|posts*` (contract `@ai/contracts/community`, route theo `community-web/src/api/client.ts`).
// Mỗi request: quyền (cache) + danh bạ (1 câu hub) + một tx gói với số câu cố định (`post.service`). "Không thấy" = 404.
import {
  CreatePostInputSchema,
  FeedQuerySchema,
  PostActionInputSchema,
  type PostSource,
  UpdatePostInputSchema,
} from "@ai/contracts/community";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseIdParam, parseWith, readJson, withoutScopeKeys } from "../../../../lib/http";
import type { PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { type Access, accessOf } from "./community-access";
import type { CommunityDeps } from "./community-deps";
import * as posts from "./post.service";
import type { FeedFilter } from "./post.sql";
import { namesOf, postView } from "./views";

const UUID = z.uuid();
const audienceNotAllowed = () =>
  new AppError("AUDIENCE_NOT_ALLOWED", 422, "Only the host chooses who sees a post");

function cursorOf(s: string | undefined): FeedFilter["cursor"] {
  if (!s) return null;
  const [at, id] = Buffer.from(s, "base64url").toString("utf8").split("|");
  if (!at || Number.isNaN(Date.parse(at)) || !UUID.safeParse(id).success)
    throw appError("VALIDATION_ERROR");
  return { at, id: id as string };
}
const cursorFor = (at: string, id: string) => Buffer.from(`${at}|${id}`).toString("base64url");

function feedFilter(c: Context<PackGuardVars>, a: Access): FeedFilter {
  const raw = withoutScopeKeys(c.req.query());
  const q = parseWith(FeedQuerySchema, {
    ...raw,
    ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
    ...(raw.mine === undefined ? {} : { mine: raw.mine === "true" }),
  });
  const author =
    q.authorOrgId === undefined ? null : q.authorOrgId === a.who.tenantId ? "host" : q.authorOrgId;
  return {
    org: a.org,
    tab: q.tab,
    cat: q.cat ?? null,
    area: q.area ?? null,
    author,
    q: q.q ? q.q : null,
    mine: q.mine === true,
    cursor: cursorOf(q.cursor),
    limit: q.limit,
  };
}

/** `GET /feed`: trang + đếm + facets (một câu) + con trỏ trang sau. */
async function feedJson(d: CommunityDeps, c: Context<PackGuardVars>, a: Access) {
  const f = feedFilter(c, a);
  const raw = await posts.feed(d.uow, a, f);
  const n = namesOf(a);
  const page = raw.items.slice(0, f.limit);
  const last = page.at(-1);
  const more = raw.items.length > f.limit && last;
  return {
    items: page.map((p) => postView(a, n, p)),
    counts: raw.counts,
    facets: raw.facets,
    ...(more ? { nextCursor: cursorFor(last.created_at, last.id) } : {}),
  };
}

export function postsRoutes(d: CommunityDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const access = (c: Context<PackGuardVars>, need: "read" | "write" = "read") =>
    accessOf(d.view, d.resolver, c, need);

  r.get("/feed", async (c) => c.json(await feedJson(d, c, await access(c))));

  r.post("/posts", async (c) => {
    const a = await access(c, "write");
    const input = parseWith(CreatePostInputSchema, await readJson(c));
    if (a.org !== null && input.audience) throw audienceNotAllowed();
    const { row, contactDetected } = await posts.create(d.uow, a, input, d.events);
    if (contactDetected) c.header("X-Contact-Detected", "1"); // HT-54: nhắc người đăng, không chặn
    return c.json(postView(a, namesOf(a), row), 201);
  });

  r.patch("/posts/:id", async (c) => {
    const a = await access(c, "write");
    const id = parseIdParam(c);
    const input = parseWith(UpdatePostInputSchema, await readJson(c));
    if (a.org !== null && input.audience) throw audienceNotAllowed();
    return c.json(postView(a, namesOf(a), await posts.update(d.uow, a, id, input, d.events)));
  });

  r.post("/posts/:id/actions", async (c) => {
    const a = await access(c, "write");
    const id = parseIdParam(c);
    const { action } = parseWith(PostActionInputSchema, await readJson(c));
    const row = await posts.act(d.uow, a, id, action);
    if (row === null) return c.body(null, 204);
    return c.json(postView(a, namesOf(a), row));
  });

  r.get("/posts/:id/source", async (c) => {
    const a = await access(c);
    const id = parseIdParam(c);
    const src = await posts.source(d.uow, a, id);
    if (!src) throw appError("NOT_FOUND");
    return c.json({ id, ...src } satisfies PostSource);
  });

  return r;
}
