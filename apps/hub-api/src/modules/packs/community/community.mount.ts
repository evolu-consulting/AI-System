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
import { savedUsers } from "./adapters/quote.repo";
import { quoteRoutes } from "./adapters/quote.routes";
import { stockMatchVia } from "./adapters/quote.service";
import { threadsRoutes } from "./adapters/threads.routes";
import type { HostBookReader, SupplierQuoteWriter } from "./application/pack-ports";

export { COMMUNITY_KEY };

export function communityModule(
  db: Db,
  view: PackAccessView,
  resolver: ExternalOrgResolver,
  opts: {
    shtUrl?: string;
    /** C7: chủ quản đã lưu báo giá từ bài (mặc định: bảng `quote_saves`, cờ báo khi NCC sửa giá). */
    savedBy?: CommunityEventDeps["savedBy"];
    /** C8: chủ quản có SP khớp bài Cần mua (mặc định: `HostBookReader` hỏi từng chủ quản có quyền đọc SHT). */
    stockMatch?: CommunityEventDeps["stockMatch"];
    /** ADR-0031: cổng ghi/đọc SP & Giá do `packs.mount.ts` tiêm (vắng ⇒ không Lưu báo giá / không gợi ý). */
    quotes?: SupplierQuoteWriter | undefined;
    hostBook?: HostBookReader | undefined;
    webUrl?: string | undefined;
    now?: () => Date;
  } = {},
): Hono<PackGuardVars> {
  const uow = createPackUow(db, COMMUNITY_KEY, (tx) => ({ tx }));
  const hosts = packHosts(db, view, COMMUNITY_KEY);
  const events = communityEvents({
    hosts,
    savedBy:
      opts.savedBy ??
      ((tenantId, postId) => uow.system(tenantId, ({ tx }) => savedUsers(tx, tenantId, postId))),
    ...(opts.stockMatch
      ? { stockMatch: opts.stockMatch }
      : opts.hostBook
        ? { stockMatch: stockMatchVia(opts.hostBook, hosts) }
        : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  const d: CommunityDeps = {
    view,
    resolver,
    uow,
    events,
    bell: packBell(db, COMMUNITY_KEY),
    shtUrl: opts.shtUrl ?? "/",
    quotes: opts.quotes,
    hostBook: opts.hostBook,
    webUrl: opts.webUrl,
  };
  const r = new Hono<PackGuardVars>();
  r.route("/", postsRoutes(d));
  r.route("/", threadsRoutes(d));
  r.route("/", orgRoutes(d));
  r.route("/", quoteRoutes(d));
  return r;
}

/** Gắn dưới `<prefix>/community`; "Mở SHT" = `CONTRACTS_WEB_URL` (vắng ⇒ "/"). */
export function mountCommunity<E extends Env>(
  app: Hono<E>,
  prefix: string,
  db: Db,
  view: PackAccessView,
  o: {
    signal?: AbortSignal | undefined;
    worker?: boolean;
    quotes?: SupplierQuoteWriter;
    hostBook?: HostBookReader;
  } = {},
): void {
  const { quotes, hostBook, ...sweep } = o;
  startSweeper(db, view, sweep);
  const shtUrl = process.env.CONTRACTS_WEB_URL || "/";
  app.route(
    `${prefix}/${COMMUNITY_KEY}`,
    communityModule(db, view, pgExternalOrgResolver(db), {
      shtUrl,
      ...(quotes ? { quotes } : {}),
      ...(hostBook ? { hostBook } : {}),
      webUrl: process.env.COMMUNITY_WEB_URL || undefined,
    }),
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
