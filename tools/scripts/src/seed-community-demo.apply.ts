// com-c12b · CR-102 · phần cộng đồng của seed demo: bật gói `community`, ghi vai/nhóm hàng đối tác ở SHT (`contracts.partner_roles` + `partner_profiles`, CR-130),
// đăng bài + luồng mẫu — qua CHÍNH service của gói (hub-api `post.service` / `comment-list.service`), nên che liên hệ, RLS,
// audience D2, luồng D3 chạy y như thật. Lặp lại được: bài định danh theo (người đăng, tiêu đề), bình luận theo (luồng, người, nội dung).
// `hub` = pool vai hub_api (RLS gói); `admin` = pool admin_api. Cố định số câu theo số bài (dữ liệu mẫu nhỏ, không phải đường nóng).
import { type CreatePostInput, CreatePostInputSchema } from "@ai/contracts/community";
import { type Db, type Tx, withScope } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import { grantEntitlement } from "../../../apps/admin-api/src/modules/features/features.entitlements";
import { enablePack } from "../../../apps/admin-api/src/modules/packs/packs.service";
import * as comments from "../../../apps/hub-api/src/modules/packs/community/adapters/comment-list.service";
import {
  type Access,
  COMMUNITY_KEY,
  otherOrgNames,
} from "../../../apps/hub-api/src/modules/packs/community/adapters/community-access";
import * as flows from "../../../apps/hub-api/src/modules/packs/community/adapters/flows.service";
import * as posts from "../../../apps/hub-api/src/modules/packs/community/adapters/post.service";
import { storeComment } from "../../../apps/hub-api/src/modules/packs/community/domain/content.rules";
import { pgExternalOrgResolver } from "../../../apps/hub-api/src/modules/packs/kit/adapters/ext-org.pg";
import { createPackUow } from "../../../apps/hub-api/src/modules/packs/kit/adapters/pack-uow";
import { ensureCommunityDefaultFlow } from "../../../apps/hub-api/src/modules/processes/library/flow-templates.community";
import {
  type JoinSeed,
  type MapRow,
  POST_SAMPLES,
  type PostSample,
} from "./seed-community-demo.data";

/** Ngữ cảnh đã dựng ở `runSeed`: tenant, admin chủ quản, user/công ty đối tác theo username. */
export type CommunityCtx = {
  hub: Db;
  admin: Db;
  tenantId: string;
  hostUserId: string;
  /** username đối tác → { user, công ty }. */
  partners: ReadonlyMap<string, { userId: string; orgId: string; orgName: string }>;
};

/** Add-on bật Bảng tin (ADR-0044) — khớp `PACK_SURFACES.community.addon` ở hub-api kit. */
const COMMUNITY_ADDON = "contracts-community";

export type ApplyResult = { postsCreated: number; postsExisting: number; commentsCreated: number };

/** ADR-0044: bật Bảng tin = gói `contracts` (khoá feature, entitlement, 3 Group vai, grant, audit) + add-on `contracts-community` — idempotent. */
export async function enableCommunityPack(
  admin: Db,
  tenantId: string,
  hostUserId: string,
): Promise<void> {
  const call = {
    ctx: { db: admin },
    scope: { kind: "platform" },
    actor: { userId: hostUserId },
  } as const;
  try {
    await enablePack(call, tenantId, "contracts");
  } catch (e) {
    if ((e as { code?: string }).code === "PACK_NOT_FOUND")
      throw new Error(
        'seed-community-demo: gói "contracts" chưa cài (chạy `bun run db:migrate` rồi cài gói) trước khi seed',
      );
    throw e;
  }
  const [f] = (await withScope(admin, { kind: "platform" }, (tx) =>
    tx.execute(sql`select id from admin.features where key = ${COMMUNITY_ADDON}`),
  )) as unknown as { id: string }[];
  if (!f)
    throw new Error(`seed-community-demo: thiếu feature ${COMMUNITY_ADDON} (chạy db:migrate)`);
  await grantEntitlement(call, f.id, tenantId);
}

/**
 * Ghi mẫu duyệt bài cho Community (CR-127 Z9: không còn gán cho công ty). Idempotent.
 */
export async function enableCommunityDefaultFlow(
  hub: Db,
  tenantId: string,
  hostUserId: string,
): Promise<void> {
  await ensureCommunityDefaultFlow(hub, tenantId, hostUserId);
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

/**
 * CR-130 · ADR-0043: đối tác = SHT, không còn `community.partner_companies`. Vai (`buyer` ⇒ `customer`) → `contracts.partner_roles`;
 * nhóm hàng + tài khoản công ty → `contracts.partner_profiles` (khoá = party_key SHT hoặc `name:<fold(tên)>`). MỘT câu theo tập, scope hệ thống
 * của gói contracts (không user ⇒ việc nền), upsert (đổi nhóm hàng có hiệu lực ngay; vai chỉ thêm).
 */
export async function applyLabels(c: CommunityCtx, rows: readonly MapRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const batch = rows.map((r) => ({
    org: r.org_id,
    name: r.org_name,
    pk: r.party_key,
    roles: [...new Set(r.labels.map((l) => (l === "buyer" ? "customer" : l)))],
    cats: r.categories,
  }));
  await withPackScope(c.hub, { packKey: "contracts", tenantId: c.tenantId, userId: null }, (tx) =>
    tx.execute(sql`with x as (
        select x.org, x.name, coalesce(x.pk, 'name:' || contracts.fold(x.name)) as pk, x.roles, x.cats
        from jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) as x(org uuid, name text, pk text, roles text[], cats text[])),
      r as (insert into contracts.partner_roles (tenant_id, party_key, role, name, created_from)
        select ${c.tenantId}::uuid, x.pk, role, left(x.name, 300), 'manual' from x, unnest(x.roles) as role
        on conflict (tenant_id, party_key, role) do nothing returning 1),
      p as (insert into contracts.partner_profiles as pp (tenant_id, party_key, cats, ext_org_id, invited_at)
        select ${c.tenantId}::uuid, x.pk, x.cats, x.org, now() from x
        on conflict (tenant_id, party_key) do update set cats = excluded.cats, ext_org_id = excluded.ext_org_id, updated_at = now()
        returning 1)
      select (select count(*) from r) + (select count(*) from p)`),
  );
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
  authorOrg: string | null,
  text: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    select 1 from community.comments
    where post_id = ${postId}::uuid and author_org is not distinct from ${authorOrg}::uuid
      and text_raw = ${text.normalize("NFKC")} limit 1`);
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
    media: (p.media ?? []).map((m, i) => ({ id: `seed-${i + 1}`, kind: m.kind, label: m.label })),
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
    const had = await uow.tenant(ac.host.who, ({ tx }) => commentExists(tx, postId, a.org, r.text));
    if (had) continue;
    await comments.add(uow, a, postId, {
      text: storeComment(r.text, otherOrgNames(a)),
      mentions: [],
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

/**
 * `--reset` (chỉ tenant demo — chặn cứng ở nơi gọi): xoá dữ liệu Community của tenant (bài, luồng, bình luận, đơn tham gia, báo cáo, tệp)
 * + hồ sơ Bảng tin ở SHT (`partner_profiles`) và vai `manual` của các đối tác seed. Vai từ hợp đồng KHÔNG đụng. Trả số hàng xoá.
 */
export async function resetCommunityData(
  hub: Db,
  tenantId: string,
  seedPartyKeys: readonly string[],
): Promise<{ community: number; profiles: number; roles: number }> {
  const n = (r: unknown) => (r as { length: number }).length;
  // Vai gói (`community_rw`) không có quyền DELETE ⇒ dọn bằng vai chủ DB của máy dev (seedGuard đã chặn host ngoài localhost).
  const community = await withScope(hub, { kind: "platform" }, async (tx) => {
    let c = 0;
    for (const t of ["join_requests", "reports", "quote_saves", "index_outbox", "posts", "files"])
      c += n(
        await tx.execute(
          sql`delete from ${sql.raw(`community.${t}`)} where tenant_id = ${tenantId}::uuid returning 1`,
        ),
      );
    return c;
  });
  const keys = JSON.stringify(seedPartyKeys);
  const { profiles, roles } = await withScope(hub, { kind: "platform" }, async (tx) => ({
    profiles: n(
      await tx.execute(
        sql`delete from contracts.partner_profiles where tenant_id = ${tenantId}::uuid returning 1`,
      ),
    ),
    roles: n(
      await tx.execute(sql`delete from contracts.partner_roles where tenant_id = ${tenantId}::uuid
          and created_from = 'manual' and party_key in (select jsonb_array_elements_text(${keys}::jsonb)) returning 1`),
    ),
  }));
  return { community, profiles, roles };
}

/** Đơn xin tham gia mẫu (đang chờ): người xin = user công ty ngoài chưa gắn SHT. Idempotent (đã có đơn chờ ⇒ 409 ⇒ bỏ qua). Trả số đơn mới. */
export async function seedJoinRequests(
  c: CommunityCtx,
  joiners: readonly { userId: string; orgId: string; seed: JoinSeed }[],
): Promise<number> {
  const uow = uowOf(c.hub);
  let n = 0;
  for (const j of joiners) {
    const a = await accessFor(c, j.userId, j.orgId);
    try {
      await flows.createJoin({ uow, sys: {} as never }, a, {
        company: j.seed.name,
        contact: j.seed.contact,
        email: j.seed.email,
        reason: j.seed.reason,
        labels: [...j.seed.labels],
      });
      n += 1;
    } catch (e) {
      if ((e as { code?: string }).code !== "JOIN_PENDING_EXISTS") throw e;
    }
  }
  return n;
}
