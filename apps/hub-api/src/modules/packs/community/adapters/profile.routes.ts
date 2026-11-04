// CR-110 · COM-FR-37 · hồ sơ: `GET /profile/:orgId/media` (tab "Ảnh & tệp") + uy tín cho tab "Đối tác" (`/partners?rep=1`, chỉ chủ quản).
// Hồ sơ được xem theo đúng `profileTarget` của `/profile/:orgId` (đối tác: công ty mình + chủ quản; khác ⇒ 404). Đính kèm lọc bằng RLS
// người xem (MỘT câu mỗi trang, `media.sql.ts`). Uy tín: MỘT lời gọi cổng `HostBookReader` theo tập khoá; đối tác không bao giờ gọi.
import {
  type PartnerOrg,
  type ProfileMedia,
  ProfileMediaQuerySchema,
} from "@ai/contracts/community";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { appError } from "../../../../lib/errors";
import { parseWith, withoutScopeKeys } from "../../../../lib/http";
import type { PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { type Access, accessOf } from "./community-access";
import type { CommunityDeps } from "./community-deps";
import type { MediaCursor, MediaRow } from "./media.sql";
import * as orgs from "./org.service";

const UUID = z.uuid();

/** Hồ sơ được xem: chủ quản = mọi bên; đối tác = công ty mình + chủ quản. `null` = chủ quản | id công ty | undefined (404). */
export function profileTarget(a: Access, orgId: string | undefined): string | null | undefined {
  const id = orgId ?? a.org ?? a.who.tenantId;
  if (id === a.who.tenantId) return null;
  if (!a.dir.orgs.some((o) => o.id === id)) return undefined;
  return a.org === null || id === a.org ? id : undefined;
}

function cursorOf(s: string | undefined): MediaCursor | null {
  if (!s) return null;
  const [at, post, pos] = Buffer.from(s, "base64url").toString("utf8").split("|");
  const n = Number(pos);
  if (!at || Number.isNaN(Date.parse(at)) || !UUID.safeParse(post).success || !Number.isInteger(n))
    throw appError("VALIDATION_ERROR");
  return { at, post: post as string, pos: n };
}
const cursorFor = (r: MediaRow) =>
  Buffer.from(`${r.created_at}|${r.post_id}|${r.position}`).toString("base64url");

async function mediaJson(d: CommunityDeps, c: Context<PackGuardVars>, a: Access) {
  const target = profileTarget(a, c.req.param("orgId"));
  if (target === undefined) throw appError("NOT_FOUND");
  const raw = withoutScopeKeys(c.req.query());
  const q = parseWith(ProfileMediaQuerySchema, {
    ...raw,
    ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
  });
  const rows = await orgs.media(d.uow, a, target, cursorOf(q.cursor), q.limit);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  const out: ProfileMedia = {
    items: page.map((r) => ({
      id: r.id,
      postId: r.post_id,
      postType: r.post_type,
      kind: r.kind,
      label: r.label,
      ...(r.url ? { url: r.url } : {}),
      ...(r.file_id
        ? { fileId: r.file_id, name: r.name ?? "", size: r.size ?? 0, mime: r.mime ?? "" }
        : {}),
      createdAt: new Date(r.created_at).toISOString(),
    })),
    ...(rows.length > q.limit && last ? { nextCursor: cursorFor(last) } : {}),
  };
  return out;
}

/**
 * Uy tín (`?rep=1`): chỉ chủ quản; cổng tự kiểm quyền đọc gói contracts (không quyền ⇒ `forbidden` ⇒ danh sách giữ nguyên).
 * Chỉ đối tác đã liên kết SHT (`partyKey`) mới có điểm.
 */
export async function withReputation(
  d: CommunityDeps,
  a: Access,
  list: PartnerOrg[],
): Promise<PartnerOrg[]> {
  const keys = [...new Set(list.flatMap((p) => (p.partyKey ? [p.partyKey] : [])))];
  if (a.org !== null || !d.hostBook || keys.length === 0) return list;
  try {
    const r = await d.hostBook.read({ ...a.who, kind: "internal" }, { hints: [], partyKeys: keys });
    const rep = new Map(r.partners.map((p) => [p.partyKey, { band: p.band, score: p.score }]));
    return list.map((p) => {
      const x = p.partyKey ? rep.get(p.partyKey) : undefined;
      return x ? { ...p, reputation: x } : p;
    });
  } catch (e) {
    if ((e as { kind?: string }).kind !== "forbidden") throw e;
    return list;
  }
}

export function profileRoutes(d: CommunityDeps): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/profile/:orgId/media", async (c) =>
    c.json(await mediaJson(d, c, await accessOf(d.view, d.resolver, c, "read"))),
  );
  return r;
}
