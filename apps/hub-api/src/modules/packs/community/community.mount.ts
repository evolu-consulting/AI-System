// CR-102 · com-c3 · nối gói `community` (lớp 4): `PackUow` (role `community_rw`, RLS người xem theo `packs.viewer_ext_org()`)
// + cổng kit `ExternalOrgResolver` (danh bạ) + route `/pack/community/*`. `packs.mount.ts` gọi `mountCommunity`.
import type { Db } from "@ai/db";
import { type Env, Hono } from "hono";
import { pgExternalOrgResolver } from "../kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import type { ExternalOrgResolver } from "../kit/application/ext-org.ports";
import { COMMUNITY_KEY } from "./adapters/community-access";
import type { CommunityDeps } from "./adapters/community-deps";
import { orgRoutes } from "./adapters/org.routes";
import { postsRoutes } from "./adapters/posts.routes";
import { threadsRoutes } from "./adapters/threads.routes";

export { COMMUNITY_KEY };

export function communityModule(
  db: Db,
  view: PackAccessView,
  resolver: ExternalOrgResolver,
  opts: { shtUrl?: string } = {},
): Hono<PackGuardVars> {
  const uow = packTenantOnly(createPackUow(db, COMMUNITY_KEY, (tx) => ({ tx })));
  const d: CommunityDeps = { view, resolver, uow, shtUrl: opts.shtUrl ?? "/" };
  const r = new Hono<PackGuardVars>();
  r.route("/", postsRoutes(d));
  r.route("/", threadsRoutes(d));
  r.route("/", orgRoutes(d));
  return r;
}

/** Gắn dưới `<prefix>/community`; "Mở SHT" = `CONTRACTS_WEB_URL` (vắng ⇒ "/"). */
export function mountCommunity<E extends Env>(
  app: Hono<E>,
  prefix: string,
  db: Db,
  view: PackAccessView,
): void {
  const shtUrl = process.env.CONTRACTS_WEB_URL || "/";
  app.route(
    `${prefix}/${COMMUNITY_KEY}`,
    communityModule(db, view, pgExternalOrgResolver(db), { shtUrl }),
  );
}
