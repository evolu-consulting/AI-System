// PK-FR-05 · PK-FR-09 · D-09 · N1 plan §9 · lớp 4 của module gói (gộp mount tối thiểu T5b `app.packs.ts`): `GET /pack/<k>/me`
// + route nghiệp vụ từng gói dưới `/pack/<k>`. Chỗ DUY NHẤT nối `modules/config` (ConfigCache thoả cổng `PackAccessView`) vào
// module gói. JWT ở gốc: `PACK_PREFIX` nằm trong `PROTECTED_PREFIXES` của `app.ts` (401 trước 404). Gói `pkdemo` (D-08) chỉ
// ngoài production: `deps.packs.pkdemo` ưu tiên, vắng ⇒ `pkdemoEnabled(appEnv)` (review m-04: chỉ khi khai báo rõ dev/test).
import { packFeatureKey } from "@ai/contracts";
import type { Db } from "@ai/db";
import type { Env, Hono } from "hono";
import { logger } from "../../lib/logger";
import type { Redis } from "../../lib/redis";
import { createTaxRegistry, taxBaseUrl } from "../../lib/tax-registry.http";
import { FileboxClient } from "../attachments/filebox.client";
import { envFileboxToken } from "../attachments/filebox-token";
import { DEFAULT_TENANT_TZ } from "../config/config.rules";
import type { ConfigCache } from "../config/config.service";
import { ACTIONS_TENANT_DAILY, actionQuota } from "./contracts/adapters/action-quota";
import type { ExtractionStarter } from "./contracts/application/upload-contract.ports";
import { cksModule } from "./contracts/cks/cks.mount";
import { CONTRACTS_KEY, contractsModule } from "./contracts/contracts.mount";
import { type ContractsAiDeps, contractsAiModule } from "./contracts/extraction.mount";
import { type ContractsRemindDeps, contractsRemindModule } from "./contracts/reminders.mount";
import { uploadModule } from "./contracts/upload.mount";
import { packMeRoutes } from "./kit/adapters/me.route";
import { createPackFiles, packFilesRepo } from "./kit/adapters/pack-files.filebox";
import { packFilesRoutes } from "./kit/adapters/pack-files.routes";
import type { PackAccessView } from "./kit/adapters/pack-guard.middleware";
import type { PackToolRegistry } from "./kit/adapters/pack-tools.registry";
import { createPackUow, packTenantOnly } from "./kit/adapters/pack-uow";
import type { PackRunsBridge } from "./kit/application/pack-runs.ports";
import { PKDEMO_KEY, pkdemoModule } from "./pkdemo/pkdemo.mount";

export const PACK_PREFIX = "/pack";

/** Seam `AppDeps.packs` (test ↔ hub-api). `filebox` dành cho T5f (FileBox `org` theo tenant). `contracts` vắng ⇒ bật (HD1). */
export type PacksDeps = {
  pkdemo?: boolean;
  contracts?: boolean;
  filebox?: { url: string; token: string };
  /** HD2 · agent trích (transport) + tra MST + hook test; vắng ⇒ agent chưa cấu hình, MST theo env. */
  contractsAi?: ContractsAiDeps;
  /** HD4 · vòng nhắc hạn; `worker` vắng ⇒ bật khi `APP_ENV` development/production và `CONTRACTS_REMIND` ≠ off. */
  contractsRemind?: ContractsRemindDeps;
};

export type PacksMountDeps = {
  db?: Db;
  config: ConfigCache;
  appEnv?: "development" | "test" | "production";
  packs?: PacksDeps;
  /** HD1 T10 · bộ đếm quota tải lên (D-17). */
  redis?: Redis;
  /** N2-FR-01 · cầu khởi chạy run quy trình (engine gắn khi mount). */
  packRuns?: PackRunsBridge;
  /** N2-FR-03 · registry tool gói (dùng chung với engine + `/mcp`). */
  packTools?: PackToolRegistry;
  /** HD4 · dừng vòng nhắc khi server tắt. */
  signal?: AbortSignal;
};

/** Review m-04 · `pkdemo` chỉ mở khi `APP_ENV` khai báo rõ `development`/`test`; vắng hoặc giá trị lạ ⇒ tắt (fail-closed). */
export const pkdemoEnabled = (appEnv: string | undefined): boolean =>
  appEnv === "development" || appEnv === "test";

/** Gắn `/pack/*` (gọi sau khi đã gắn `requireAuth`); trả cổng quyền gói. */
export function mountPacks<E extends Env>(app: Hono<E>, d: PacksMountDeps): PackAccessView {
  const view: PackAccessView = d.config;
  d.packTools?.bindView(view, (m, meta) => logger.warn(m, meta)); // N2-FR-03 · gói bật theo cache guard
  app.route(PACK_PREFIX, packMeRoutes(view));
  const pkdemoOn = d.packs?.pkdemo ?? pkdemoEnabled(d.appEnv ?? process.env.APP_ENV);
  const n2 = { runs: d.packRuns, tools: d.packTools };
  if (d.db && pkdemoOn) app.route(`${PACK_PREFIX}/${PKDEMO_KEY}`, pkdemoModule(d.db, view, n2));
  const fb = packFilebox(d.packs);
  if (d.db && pkdemoOn && fb)
    app.route(`${PACK_PREFIX}/${PKDEMO_KEY}`, packFiles(d.db, view, PKDEMO_KEY, fb)); // T5f
  if (d.db && (d.packs?.contracts ?? true)) mountContracts(app, { ...d, db: d.db }, view, fb);
  rejectToolCollisions(d);
  return view;
}

/** Security L1 · sau khi mọi gói đăng ký: tool gói trùng khoá workflow catalog bị gỡ (ảnh catalog đầu tiên, cache). */
function rejectToolCollisions(d: PacksMountDeps): void {
  const tools = d.packTools;
  if (!tools) return;
  void d.config
    .catalog()
    .then((c) =>
      tools.rejectCatalogCollisions(new Set([...c.workflows.values()].map((w) => w.key))),
    )
    .catch(() => logger.warn("pack-tool-collision-check-failed", {}));
}

/** HD1 (đọc/sửa, tải lên) + HD2 (trích, nhập tay) + HD3 (flow duyệt trên engine: starter, tool gói, quét, trần thao tác). */
function mountContracts<E extends Env>(
  app: Hono<E>,
  d: PacksMountDeps & { db: Db },
  view: PackAccessView,
  fb: PackFb | null,
): void {
  const db = d.db;
  const base = `${PACK_PREFIX}/${CONTRACTS_KEY}`;
  const timeZoneOf = async (tid: string) =>
    (await d.config.tenant(tid))?.timezone ?? DEFAULT_TENANT_TZ;
  app.route(base, contractsModule(db, view, fb ? fileboxClients(fb) : null, { timeZoneOf })); // HD1 T7 + T8 (link tệp) · HD5 ngày giá theo múi tenant
  const aiDeps = d.packs?.contractsAi ?? {};
  const tax = aiDeps.tax === undefined ? envTaxRegistry() : aiDeps.tax;
  const ai = contractsAiModule(
    db,
    view,
    { ...aiDeps, tax },
    {
      bridge: d.packRuns ?? {},
      ...(d.packTools ? { tools: d.packTools } : {}),
      quota: actionQuota({
        ...(d.redis ? { redis: d.redis } : {}),
        limit: envInt("CONTRACTS_ACTIONS_TENANT_DAY", ACTIONS_TENANT_DAILY),
        timeZoneOf,
      }),
      tenants: () => packTenants(view, CONTRACTS_KEY),
      ...(d.signal ? { signal: d.signal } : {}),
    },
  );
  app.route(base, ai.routes); // HD2
  app.route(base, ai.approval); // HD3
  if (fb) app.route(base, contractsUpload(d, view, { db, fb, starter: ai.starter })); // HD1 T10 + HD2 starter
  app.route(base, contractsRemind(d, view, db)); // HD4
  app.route(base, cksModule(db, view, { timeZoneOf: tenantTz(d) })); // HD9
}

/** BR-6 (HD9) · múi giờ tenant từ `ConfigCache` (0 SQL khi nóng), vắng ⇒ mặc định. */
const tenantTz = (d: PacksMountDeps) => async (tid: string) =>
  (await d.config.tenant(tid))?.timezone ?? DEFAULT_TENANT_TZ;

/** HD4 · nhắc hạn + kết quả xử lý; múi tenant từ `ConfigCache` (0 SQL). Test bật vòng bằng `packs.contractsRemind.worker`. */
function contractsRemind(d: PacksMountDeps, view: PackAccessView, db: Db) {
  const r = d.packs?.contractsRemind ?? {};
  const env = d.appEnv ?? process.env.APP_ENV;
  const worker =
    r.worker ??
    ((env === "development" || env === "production") && process.env.CONTRACTS_REMIND !== "off");
  const every = Number(process.env.CONTRACTS_REMIND_EVERY_MS);
  return contractsRemindModule(db, view, {
    ...(Number.isInteger(every) && every >= 1000 ? { everyMs: every } : {}),
    ...r,
    worker,
    timeZoneOf: async (tid) => (await d.config.tenant(tid))?.timezone ?? DEFAULT_TENANT_TZ,
    ...(d.signal ? { signal: d.signal } : {}),
  });
}

/** Env số nguyên dương, sai/vắng ⇒ mặc định. */
const envInt = (k: string, def: number): number => {
  const n = Number(process.env[k]);
  return Number.isInteger(n) && n > 0 ? n : def;
};

/** HD3 · tenant có entitlement `<k>-read` (cache cấu hình, 0 SQL) — tập quét của vòng flow duyệt. */
async function packTenants(view: PackAccessView, key: string): Promise<string[]> {
  const cat = await view.catalog();
  const f = cat.features.find((x) => x.key === packFeatureKey(key, "read"));
  if (!f) return [];
  const suffix = `:${f.id}`;
  return [...cat.entitled].filter((e) => e.endsWith(suffix)).map((e) => e.slice(0, -suffix.length));
}

/** HD2 · tra MST Cục Thuế (egress `lib/`, gói không gọi HTTP): `CONTRACTS_TAX_LOOKUP_URL` vắng/sai ⇒ không tra. */
function envTaxRegistry() {
  const base = taxBaseUrl(process.env.CONTRACTS_TAX_LOOKUP_URL);
  return base ? createTaxRegistry({ baseUrl: base, log: logger }) : null;
}

/** HD1 T10 · tải lên: Redis = `deps.redis` (vắng ⇒ 503, D-17); múi tenant từ `ConfigCache` (D-16, 0 SQL mỗi request). */
function contractsUpload(
  d: PacksMountDeps,
  view: PackAccessView,
  { db, fb, starter }: { db: Db; fb: PackFb; starter: ExtractionStarter },
) {
  return uploadModule({
    db,
    view,
    ...(d.redis ? { redis: d.redis } : {}),
    filebox: fileboxClients(fb),
    timeZoneOf: async (tid) => (await d.config.tenant(tid))?.timezone ?? DEFAULT_TENANT_TZ,
    starter,
  });
}

/** Client FileBox theo org `t_<tenant>` (mỗi lời gọi một org, PK-FR-06). */
function fileboxClients(fb: PackFb) {
  const token = envFileboxToken(fb.token);
  return (org: string) =>
    new FileboxClient({ ...fb, org, token, timeoutMs: 10_000, retryDelaysMs: [200], log: logger });
}

/** T5f · FileBox của gói: `deps.packs.filebox` ưu tiên, vắng ⇒ env FB1 (`FILEBOX_URL` + `FILEBOX_TOKEN`, CA `FILEBOX_CA`). */
type PackFb = { url: string; token: string; caPath?: string };
function packFilebox(p: PacksDeps | undefined): PackFb | null {
  if (p?.filebox) return p.filebox;
  const { FILEBOX_URL: url, FILEBOX_TOKEN: token, FILEBOX_CA: caPath } = process.env;
  return url && token ? { url, token, ...(caPath ? { caPath } : {}) } : null;
}

/** T5f · route file gói `/files/:id/content` — client FileBox dựng theo org `t_<tenant>` mỗi lời gọi (PK-FR-06). */
function packFiles(db: Db, view: PackAccessView, key: string, fb: PackFb) {
  const client = fileboxClients(fb);
  const repo = packFilesRepo(key);
  const uow = packTenantOnly(createPackUow(db, key, (tx, tid) => ({ files: repo(tx, tid) })));
  const files = createPackFiles({
    packKey: key,
    uow,
    client,
    log: logger,
    newId: () => Bun.randomUUIDv7(),
  });
  return packFilesRoutes(view, key, files);
}
