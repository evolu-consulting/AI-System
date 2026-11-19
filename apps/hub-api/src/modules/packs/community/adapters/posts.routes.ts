// CR-102 · com-c3 · `/pack/community/feed|posts*` (contract `@ai/contracts/community`, route theo `community-web/src/api/client.ts`).
// Mỗi request: quyền (cache) + danh bạ (1 câu hub) + một tx gói với số câu cố định (`post.service`). "Không thấy" = 404.
import {
  ConnectedAudienceQuerySchema,
  CreatePostInputSchema,
  FeedQuerySchema,
  GoodsSuggestQuerySchema,
  MentionablePeopleQuerySchema,
  PostActionInputSchema,
  type PostSource,
  UpdatePostInputSchema,
} from "@ai/contracts/community";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseIdParam, parseWith, readJson, withoutScopeKeys } from "../../../../lib/http";
import type { PackGuardVars } from "../../kit/public";
import { mergeNewest } from "../domain/feed-merge.rules";
import { type Access, accessOf } from "./community-access";
import type { CommunityDeps } from "./community-deps";
import { suggestGoods } from "./goods-suggest.service";
import * as posts from "./post.service";
import type { FeedFilter } from "./post.sql";
import { listConnectedAudience, suggest as suggestPeople } from "./post-mention.service";
import { quoteDeps } from "./quote.routes";
import { hostHints } from "./quote.service";
import { connectedView, namesOf, postView } from "./views";

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
    source: q.source ?? null,
    authorUser: q.authorUserId ?? null,
    q: q.q ? q.q : null,
    mine: q.mine === true,
    cursor: cursorOf(q.cursor),
    limit: q.limit,
  };
}

/** `GET /feed` (CR-191 bảng tin gộp): bài công ty mình + bài công ty đã kết nối, trộn mới nhất trước, `limit` bài/trang, con trỏ
 * `(created_at, id)` dùng chung hai nguồn. Đếm + facets = của công ty mình (một câu). */
async function feedJson(d: CommunityDeps, c: Context<PackGuardVars>, a: Access) {
  const f = feedFilter(c, a);
  const { own, connected } = await posts.feed(d.uow, a, f);
  const n = namesOf(a);
  const { items, more } = mergeNewest(own.items, connected, f.limit);
  const page = items.flatMap((x) => (x.src === "own" ? [x.row] : []));
  const last = items.at(-1)?.row;
  const hints = await hostHints(quoteDeps(d), a, page); // C8: một lời gọi cổng đọc mỗi trang (chỉ chủ quản)
  return {
    items: items.map((x) =>
      x.src === "own" ? postView(a, n, x.row, hints.get(x.row.id)) : connectedView(x.row),
    ),
    counts: own.counts,
    facets: own.facets,
    ...(more && last ? { nextCursor: cursorFor(last.created_at, last.id) } : {}),
  };
}

export function postsRoutes(d: CommunityDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const access = (c: Context<PackGuardVars>, need: "read" | "write" = "read") =>
    accessOf(d.view, d.resolver, c, need);

  r.get("/feed", async (c) => c.json(await feedJson(d, c, await access(c))));

  /** CR-191 · công ty ĐÃ KẾT NỐI + công ty đó có thấy bài với «Ai thấy bài» này không (cho «n/N», «Chọn công ty…», gợi ý «@»). Đối tác ngoài ⇒ rỗng. */
  r.get("/audience-connected", async (c) => {
    const a = await access(c);
    const q = parseWith(ConnectedAudienceQuerySchema, c.req.query());
    if (a.org !== null) return c.json([]);
    return c.json(await listConnectedAudience(d.uow, a, q.mode, q.tenants));
  });

  /** CR-191 · gợi ý hàng hoá (Cần bán/Cần mua): hàng công ty đã đăng + Sản phẩm & Giá (cổng `goods`). */
  r.get("/goods-suggest", async (c) => {
    const a = await access(c);
    const q = parseWith(GoodsSuggestQuerySchema, c.req.query());
    return c.json(await suggestGoods(d.uow, a, d.goods, q.q ?? ""));
  });

  /** CR-145: gợi ý người «Nhắc tên» (≤ 20, tìm `q`); phạm vi theo bài (`postId`) hoặc bản nháp. Không cấu hình ⇒ rỗng. */
  r.get("/mentionable-people", async (c) => {
    const a = await access(c);
    const raw = withoutScopeKeys(c.req.query());
    const q = parseWith(MentionablePeopleQuerySchema, {
      ...raw,
      ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
    });
    return c.json(d.mention ? await suggestPeople(d.uow, a, d.mention, q) : []);
  });

  r.post("/posts", async (c) => {
    const a = await access(c, "write");
    const input = parseWith(CreatePostInputSchema, await readJson(c));
    if (a.org !== null && input.audience) throw audienceNotAllowed();
    const { row, contactDetected } = await posts.create(
      d.uow,
      a,
      input,
      d.events,
      d.flows,
      d.mention,
    );
    if (contactDetected) c.header("X-Contact-Detected", "1"); // HT-54: nhắc người đăng, không chặn
    return c.json(postView(a, namesOf(a), row), 201);
  });

  r.patch("/posts/:id", async (c) => {
    const a = await access(c, "write");
    const id = parseIdParam(c);
    const input = parseWith(UpdatePostInputSchema, await readJson(c));
    if (a.org !== null && input.audience) throw audienceNotAllowed();
    return c.json(
      postView(
        a,
        namesOf(a),
        await posts.update(d.uow, a, id, input, d.events, d.flows, d.mention),
      ),
    );
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
