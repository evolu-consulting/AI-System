// CR-102 · com-c3 · nối gói `community` (lớp 4): `PackUow` (role `community_rw`, RLS người xem theo `packs.viewer_ext_org()`)
// + cổng kit `ExternalOrgResolver` (danh bạ) + route `/pack/community/*`. `packs.mount.ts` gọi `mountCommunity`.
import { packFeatureKey } from "@ai/contracts";
import type { Db } from "@ai/db";
import { type Env, Hono } from "hono";
import { pgExternalOrgResolver } from "../kit/adapters/ext-org.pg";
import { packBell } from "../kit/adapters/pack-bell";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { packHosts } from "../kit/adapters/pack-hosts";
import { createPackUow } from "../kit/adapters/pack-uow";
import type { ExternalOrgResolver } from "../kit/application/ext-org.ports";
import { COMMUNITY_KEY } from "./adapters/community-access";
import type { CommunityDeps } from "./adapters/community-deps";
import type { CommunityEventDeps } from "./adapters/notify.events";
import { communityEvents } from "./adapters/notify.events";
import { startCommunitySweeper } from "./adapters/notify.sweep";
import { orgRoutes } from "./adapters/org.routes";
import { postsRoutes } from "./adapters/posts.routes";
import { threadsRoutes } from "./adapters/threads.routes";

export { COMMUNITY_KEY };

export function communityModule(
  db: Db,
  view: PackAccessView,
  resolver: ExternalOrgResolver,
  opts: {
    shtUrl?: string;
    /** C7: chủ quản đã lưu báo giá từ bài (vắng ⇒ không phát `priceEdited`). */
    savedBy?: CommunityEventDeps["savedBy"];
    /** C8: chủ quản có SP khớp bài Cần mua qua `HostBookReader` (vắng ⇒ không phát `matchBuy`). */
    stockMatch?: CommunityEventDeps["stockMatch"];
    now?: () => Date;
  } = {},
): Hono<PackGuardVars> {
  const uow = createPackUow(db, COMMUNITY_KEY, (tx) => ({ tx }));
  const events = communityEvents({
    hosts: packHosts(db, view, COMMUNITY_KEY),
    ...(opts.savedBy ? { savedBy: opts.savedBy } : {}),
    ...(opts.stockMatch ? { stockMatch: opts.stockMatch } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  const d: CommunityDeps = {
    view,
    resolver,
    uow,
    events,
    bell: packBell(db, COMMUNITY_KEY),
    shtUrl: opts.shtUrl ?? "/",
  };
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
  o: { signal?: AbortSignal | undefined; worker?: boolean } = {},
): void {
  startSweeper(db, view, o);
  const shtUrl = process.env.CONTRACTS_WEB_URL || "/";
  app.route(
    `${prefix}/${COMMUNITY_KEY}`,
    communityModule(db, view, pgExternalOrgResolver(db), { shtUrl }),
  );
}

/** Tenant có entitlement `community-read` (cache cấu hình, 0 SQL) — tập quét của vòng nền. */
async function communityTenants(view: PackAccessView): Promise<string[]> {
  const cat = await view.catalog();
  const f = cat.features.find((x) => x.key === packFeatureKey(COMMUNITY_KEY, "read"));
  if (!f || f.status === "off") return [];
  const suffix = `:${f.id}`;
  return [...cat.entitled].filter((e) => e.endsWith(suffix)).map((e) => e.slice(0, -suffix.length));
}

/** C9 · vòng tự lưu trữ + nhắc hết hạn + tổng hợp; bật khi APP_ENV development/production và `COMMUNITY_SWEEP` ≠ off. */
function startSweeper(
  db: Db,
  view: PackAccessView,
  o: { signal?: AbortSignal | undefined; worker?: boolean },
) {
  const env = process.env.APP_ENV;
  const on =
    o.worker ??
    ((env === "development" || env === "production") && process.env.COMMUNITY_SWEEP !== "off");
  if (!on) return;
  const every = Number(process.env.COMMUNITY_SWEEP_EVERY_MS);
  startCommunitySweeper({
    uow: createPackUow(db, COMMUNITY_KEY, (tx) => ({ tx })),
    tenants: () => communityTenants(view),
    hosts: packHosts(db, view, COMMUNITY_KEY),
    everyMs: Number.isInteger(every) && every >= 1000 ? every : 60_000,
    ...(o.signal ? { signal: o.signal } : {}),
    warn: (m, meta) => console.warn(m, meta),
  });
}
