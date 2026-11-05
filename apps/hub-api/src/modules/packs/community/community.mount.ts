// CR-102 · com-c3 · nối gói `community` (lớp 4): `PackUow` (role `community_rw`, RLS người xem theo `packs.viewer_ext_org()`)
// + cổng kit `ExternalOrgResolver` (danh bạ) + route `/pack/community/*`. `packs.mount.ts` gọi `mountCommunity`.
import { packFeatureKey } from "@ai/contracts/packs";
import type { Db } from "@ai/db";
import { type Env, Hono } from "hono";
import { pgExternalOrgResolver } from "../kit/adapters/ext-org.pg";
import { flowRoutes } from "../kit/adapters/flow.routes";
import { packBell } from "../kit/adapters/pack-bell";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { packHosts } from "../kit/adapters/pack-hosts";
import { createPackUow } from "../kit/adapters/pack-uow";
import { slotRegistry } from "../kit/adapters/slot-registry";
import type { ExternalOrgResolver } from "../kit/application/ext-org.ports";
import { flowRuntime, flowRuntimeOn } from "../kit/application/flow.ports";
import type { PackWho } from "../kit/application/ports";
import { COMMUNITY_KEY } from "./adapters/community-access";
import type { CommunityDeps } from "./adapters/community-deps";
import { filesRoutes } from "./adapters/files.routes";
import { communityFlowSlots } from "./adapters/flow-slots";
import { flowsRoutes } from "./adapters/flows.routes";
import type { FlowAgents, FlowDeps } from "./adapters/flows.service";
import type { CommunityEventDeps } from "./adapters/notify.events";
import { communityEvents } from "./adapters/notify.events";
import { startCommunitySweeper } from "./adapters/notify.sweep";
import { orgRoutes } from "./adapters/org.routes";
import { postsRoutes } from "./adapters/posts.routes";
import { profileRoutes } from "./adapters/profile.routes";
import { quoteRoutes } from "./adapters/quote.routes";
import { stockMatchVia } from "./adapters/quote.service";
import { threadsRoutes } from "./adapters/threads.routes";
import type {
  CommunityBlobs,
  CommunityUploadGate,
  CompanyBrandReader,
  ContractsCapReader,
  HostBookReader,
  SupplierQuoteWriter,
} from "./application/pack-ports";
import { communitySlotSpecs } from "./domain/flow-slots.rules";

export { COMMUNITY_KEY };

export function communityModule(
  db: Db,
  view: PackAccessView,
  resolver: ExternalOrgResolver,
  opts: {
    shtUrl?: string;
    /** C7: chủ quản đã lưu báo giá từ bài (mặc định: bảng `quote_saves`, cờ báo khi NCC sửa giá). */
    savedBy?: CommunityEventDeps["savedBy"];
    /** C8: chủ quản có SP khớp bài Cần mua (mặc định: `HostBookReader.stockHolders`, một lời gọi theo tập). */
    stockMatch?: CommunityEventDeps["stockMatch"];
    /** ADR-0031: cổng ghi/đọc SP & Giá do `packs.mount.ts` tiêm (vắng ⇒ không Lưu báo giá / không gợi ý). */
    quotes?: SupplierQuoteWriter | undefined;
    hostBook?: HostBookReader | undefined;
    /** CR-110: brand chủ quản + quyền gói contracts (vắng ⇒ brand mặc định theo tên tenant, caps false). */
    brand?: CompanyBrandReader | undefined;
    caps?: ContractsCapReader | undefined;
    webUrl?: string | undefined;
    /** CR-118 §11.1: kho byte tệp bài (vắng ⇒ `/files` 503). */
    blobs?: CommunityBlobs | undefined;
    /** cr118-files-quota: giữ lượt tải tệp (vắng ⇒ không giới hạn — chỉ seam test). */
    gate?: CommunityUploadGate | undefined;
    uploadsInflight?: number | undefined;
    now?: () => Date;
    /** CR-120: cổng 3 khe (agent Hub, khe duyệt bài bật cho tenant, tenant admin, cờ flow runtime, seam việc nền). */
    flows?: CommunityFlowOpts | undefined;
  } = {},
): Hono<PackGuardVars> {
  const uow = createPackUow(db, COMMUNITY_KEY, (tx) => ({ tx }));
  const hosts = packHosts(db, view, COMMUNITY_KEY);
  const stockMatch = opts.stockMatch ?? (opts.hostBook ? stockMatchVia(opts.hostBook) : undefined);
  // review Cao-1/TB-2: chuông phát SAU commit trên tx hệ thống riêng (không lồng tx khi đang giữ tx nghiệp vụ)
  const events = communityEvents({
    uow,
    hosts,
    ...(opts.savedBy ? { savedBy: opts.savedBy } : {}),
    ...(stockMatch ? { stockMatch } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    warn: (m, meta) => console.warn(m, meta),
  });
  const fo = opts.flows ?? {};
  const flows: FlowDeps = {
    uow,
    sys: uow,
    agents: fo.agents,
    moderationOn: fo.moderationOn,
    background: fo.background,
    warn: (m, meta) => console.warn(m, meta),
    onApproved: async (p, tenantId) => {
      await events.emitNewPost({
        tenantId,
        postId: p.id,
        type: p.type,
        authorOrg: p.author_org,
        authorUserId: p.author_user_id,
        actorName: p.author_name,
        titleMasked: p.title_masked,
        ...(p.product ? { product: p.product } : {}),
      });
    },
  };
  const d: CommunityDeps = {
    view,
    resolver,
    uow,
    events,
    flows,
    bell: packBell(db, COMMUNITY_KEY),
    shtUrl: opts.shtUrl ?? "/",
    quotes: opts.quotes,
    hostBook: opts.hostBook,
    brand: opts.brand,
    caps: opts.caps,
    webUrl: opts.webUrl,
    blobs: opts.blobs,
    gate: opts.gate,
    uploadsInflight: opts.uploadsInflight,
  };
  const r = new Hono<PackGuardVars>();
  r.route("/", postsRoutes(d));
  r.route("/", threadsRoutes(d));
  r.route("/", orgRoutes(d));
  r.route("/", profileRoutes(d));
  r.route("/", quoteRoutes(d));
  r.route("/", filesRoutes(d));
  r.route("/", flowsRoutes(d, flows));
  // CR-120 · ADR-0035/0036: SlotSpec + FlowSlotAdapter của 3 khe (khoá = key khe); route flow kit sau cờ runtime.
  for (const s of communitySlotSpecs()) slotRegistry.register(s);
  if (flowRuntimeOn(fo.runtimeOn)) {
    const slots = communityFlowSlots(flows, { view, resolver, tenantAdmin: fo.tenantAdmin });
    r.route("/", flowRoutes(view, COMMUNITY_KEY, flowRuntime(COMMUNITY_KEY, slots)));
  }
  return r;
}

export type CommunityFlowOpts = {
  agents?: FlowAgents | undefined;
  moderationOn?: ((tenantId: string) => Promise<boolean>) | undefined;
  tenantAdmin?: ((who: PackWho) => Promise<boolean>) | undefined;
  background?: ((p: Promise<unknown>) => void) | undefined;
  /** Seam test của cờ `HUB_FLOW_RUNTIME` (vắng ⇒ env). */
  runtimeOn?: boolean | undefined;
};

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
    brand?: CompanyBrandReader;
    caps?: ContractsCapReader;
    blobs?: CommunityBlobs;
    gate?: CommunityUploadGate;
    flows?: CommunityFlowOpts;
  } = {},
): void {
  const { quotes, hostBook, brand, caps, blobs, gate, flows, ...sweep } = o;
  startSweeper(db, view, { ...sweep, ...(blobs ? { blobs } : {}) });
  const shtUrl = process.env.CONTRACTS_WEB_URL || "/";
  app.route(
    `${prefix}/${COMMUNITY_KEY}`,
    communityModule(db, view, pgExternalOrgResolver(db), {
      shtUrl,
      ...(quotes ? { quotes } : {}),
      ...(hostBook ? { hostBook } : {}),
      ...(brand ? { brand } : {}),
      ...(caps ? { caps } : {}),
      ...(blobs ? { blobs } : {}),
      ...(gate ? { gate } : {}),
      ...(flows ? { flows } : {}),
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
  o: { signal?: AbortSignal | undefined; worker?: boolean; blobs?: CommunityBlobs },
) {
  const env = process.env.APP_ENV;
  const on =
    o.worker ??
    ((env === "development" || env === "production") && process.env.COMMUNITY_SWEEP !== "off");
  if (!on) return;
  const resolver = pgExternalOrgResolver(db);
  const every = Number(process.env.COMMUNITY_SWEEP_EVERY_MS);
  startCommunitySweeper({
    uow: createPackUow(db, COMMUNITY_KEY, (tx) => ({ tx })),
    tenants: () => communityTenants(view),
    hosts: packHosts(db, view, COMMUNITY_KEY),
    orgNames: (t, ids) => resolver.orgNames(t, ids),
    everyMs: Number.isInteger(every) && every >= 1000 ? every : 60_000,
    ...(o.signal ? { signal: o.signal } : {}),
    ...(o.blobs ? { blobs: o.blobs } : {}), // CR-118: pha dọn tệp bài
    warn: (m, meta) => console.warn(m, meta),
  });
}
