// com-c12b · CR-102 · phần cộng đồng của seed demo: bật gói `community`, ghi nhãn/nhóm hàng đối tác (`partner_companies`),
// đăng bài + luồng mẫu — qua CHÍNH service của gói (hub-api `post.service` / `thread.service` / `org.repo`), nên che liên hệ, RLS,
// audience D2, luồng D3 chạy y như thật. Lặp lại được: bài định danh theo (người đăng, tiêu đề), bình luận theo (luồng, người, nội dung).
// `hub` = pool vai hub_api (RLS gói); `admin` = pool admin_api. Cố định số câu theo số bài (dữ liệu mẫu nhỏ, không phải đường nóng).
import { type CreatePostInput, CreatePostInputSchema } from "@ai/contracts/community";
import type { Db, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { enablePack } from "../../../apps/admin-api/src/modules/packs/packs.service";
import {
  type Access,
  COMMUNITY_KEY,
  otherOrgNames,
} from "../../../apps/hub-api/src/modules/packs/community/adapters/community-access";
import { upsertPartner } from "../../../apps/hub-api/src/modules/packs/community/adapters/org.repo";
import * as posts from "../../../apps/hub-api/src/modules/packs/community/adapters/post.service";
import * as threads from "../../../apps/hub-api/src/modules/packs/community/adapters/thread.service";
import { storeComment } from "../../../apps/hub-api/src/modules/packs/community/domain/content.rules";
import { pgExternalOrgResolver } from "../../../apps/hub-api/src/modules/packs/kit/adapters/ext-org.pg";
import { createPackUow } from "../../../apps/hub-api/src/modules/packs/kit/adapters/pack-uow";
import { type MapRow, POST_SAMPLES, type PostSample } from "./seed-community-demo.data";

/** Ngữ cảnh đã dựng ở `runSeed`: tenant, admin chủ quản, user/công ty đối tác theo username. */
export type CommunityCtx = {
  hub: Db;
  admin: Db;
  tenantId: string;
  hostUserId: string;
  /** username đối tác → { user, công ty }. */
  partners: ReadonlyMap<string, { userId: string; orgId: string; orgName: string }>;
};

export type ApplyResult = { postsCreated: number; postsExisting: number; commentsCreated: number };

/** Bật gói `community` cho tenant bằng service admin (khoá feature, entitlement, 3 Group vai, grant, audit) — idempotent. */
export async function enableCommunityPack(
  admin: Db,
  tenantId: string,
  hostUserId: string,
): Promise<void> {
  try {
    await enablePack(
      { ctx: { db: admin }, scope: { kind: "platform" }, actor: { userId: hostUserId } },
      tenantId,
      COMMUNITY_KEY,
    );
  } catch (e) {
    if ((e as { code?: string }).code === "PACK_NOT_FOUND")
      throw new Error(
        'seed-community-demo: gói "community" chưa cài (chạy `bun run db:migrate` rồi cài gói) trước khi seed',
      );
    throw e;
  }
}

const uowOf = (hub: Db) => createPackUow(hub, COMMUNITY_KEY, (tx) => ({ tx }));

async function accessFor(c: CommunityCtx, userId: string, orgId: string | null): Promise<Access> {
  const dir = await pgExternalOrgResolver(c.hub).directory(c.tenantId, userId);
  return {
    who: {
      tenantId: c.tenantId,
      userId,
      userKind: orgId ? "external" : "internal",
      extOrgId: orgId,
    },
    org: orgId,
    canWrite: true,
    isAdmin: orgId === null,
    dir,
  };
}

/** Nhãn (supplier/buyer) + nhóm hàng + liên kết SHT của từng công ty đối tác — MỘT tx, upsert (đổi nhãn có hiệu lực ngay). */
export async function applyLabels(c: CommunityCtx, rows: readonly MapRow[]): Promise<number> {
  const host = await accessFor(c, c.hostUserId, null);
  await uowOf(c.hub).tenant(host.who, async ({ tx }) => {
    for (const r of rows)
      await upsertPartner(tx, host.who, r.org_id, {
        labels: r.labels,
        cats: r.categories,
        area: "",
        partyKey: r.party_key,
      });
  });
  return rows.length;
}

async function findPost(tx: Tx, org: string | null, title: string): Promise<string | null> {
  const rows = await tx.execute<{ id: string }>(sql`
    select id::text as id from community.posts
    where author_org is not distinct from ${org}::uuid and title_raw = ${title.normalize("NFKC")} limit 1`);
  return rows[0]?.id ?? null;
}

async function commentExists(
  tx: Tx,
  postId: string,
  threadOrg: string,
  authorOrg: string | null,
  text: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    select 1 from community.comments
    where post_id = ${postId}::uuid and thread_org = ${threadOrg}::uuid
      and author_org is not distinct from ${authorOrg}::uuid and text_raw = ${text.normalize("NFKC")} limit 1`);
  return rows.length > 0;
}

function toInput(p: PostSample): CreatePostInput {
  const audience =
    p.by === "host" && p.audience
      ? { mode: p.audience.mode, cats: [...(p.audience.cats ?? [])], companies: [] as string[] }
      : undefined;
  return CreatePostInputSchema.parse({
    type: p.type,
    title: p.title,
    body: p.body,
    fields: p.fields,
    cats: [...p.cats],
    media: [],
    ...(audience ? { audience } : {}),
  });
}

type Uow = ReturnType<typeof uowOf>;
type Actors = {
  host: Access;
  who: (by: string) => Access;
  orgOf: (username: string) => string | undefined;
};

async function actorsOf(c: CommunityCtx): Promise<Actors> {
  const host = await accessFor(c, c.hostUserId, null);
  const access = new Map<string, Access>([["host", host]]);
  for (const [username, p] of c.partners)
    access.set(username, await accessFor(c, p.userId, p.orgId));
  return {
    host,
    who: (by) => {
      const a = access.get(by);
      if (!a) throw new Error(`seed-community-demo: không có người dùng "${by}" cho bài mẫu`);
      return a;
    },
    orgOf: (u) => c.partners.get(u)?.orgId,
  };
}

/** Thêm các bình luận chưa có của một bài; trả số bình luận mới. */
async function seedReplies(uow: Uow, ac: Actors, postId: string, p: PostSample): Promise<number> {
  let n = 0;
  for (const r of p.replies ?? []) {
    const a = ac.who(r.by);
    const target = a.org ?? (r.thread ? ac.orgOf(r.thread) : undefined);
    if (!target) throw new Error(`seed-community-demo: bình luận "${r.text}" thiếu luồng`);
    const had = await uow.tenant(ac.host.who, ({ tx }) =>
      commentExists(tx, postId, target, a.org, r.text),
    );
    if (had) continue;
    await threads.add(uow, a, postId, {
      text: storeComment(r.text, otherOrgNames(a)),
      orgId: a.org === null ? target : undefined,
    });
    n += 1;
  }
  return n;
}

/** Bài + luồng mẫu. Người đăng chủ quản = admin chủ quản (không che); đối tác = user đối tác (nội dung bị che lúc ghi). */
export async function seedPosts(c: CommunityCtx): Promise<ApplyResult> {
  const uow = uowOf(c.hub);
  const res: ApplyResult = { postsCreated: 0, postsExisting: 0, commentsCreated: 0 };
  const ac = await actorsOf(c);
  for (const p of POST_SAMPLES) {
    const author = ac.who(p.by);
    let postId = await uow.tenant(ac.host.who, ({ tx }) => findPost(tx, author.org, p.title));
    if (postId) res.postsExisting += 1;
    else {
      postId = (await posts.create(uow, author, toInput(p))).row.id;
      res.postsCreated += 1;
    }
    res.commentsCreated += await seedReplies(uow, ac, postId, p);
  }
  return res;
}
