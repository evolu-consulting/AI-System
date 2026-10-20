// PK-FR-05 · PK-FR-09 · D-09 · N1 plan §9 · lớp 4 của module gói (gộp mount tối thiểu T5b `app.packs.ts`): `GET /pack/<k>/me`
// + route nghiệp vụ từng gói dưới `/pack/<k>`. Chỗ DUY NHẤT nối `modules/config` (ConfigCache thoả cổng `PackAccessView`) vào
// module gói. JWT ở gốc: `PACK_PREFIX` nằm trong `PROTECTED_PREFIXES` của `app.ts` (401 trước 404). Gói `pkdemo` (D-08) chỉ
// ngoài production: `deps.packs.pkdemo` ưu tiên, vắng ⇒ `pkdemoEnabled(appEnv)` (review m-04: chỉ khi khai báo rõ dev/test).
import { packFeatureKey } from "@ai/contracts";
import type { Db } from "@ai/db";
import type { Env, Hono } from "hono";
import type { ModelProvider } from "../../lib/ai-client/ai-client";
import { createHubAiClient } from "../../lib/ai-client/ai-client.env";
import { chatUsageSink } from "../../lib/ai-client/chat-usage.sink";
import { logger } from "../../lib/logger";
import type { Redis } from "../../lib/redis";
import { createTaxRegistry, taxBaseUrl } from "../../lib/tax-registry.http";
import { FileboxClient } from "../attachments/filebox.client";
import { envFileboxToken } from "../attachments/filebox-token";
import { DEFAULT_TENANT_TZ } from "../config/config.rules";
import type { ConfigCache } from "../config/config.service";
import { mountKnowledge } from "../knowledge/knowledge.mount";
import { setChatUsageSink } from "../usage/chat-usage";
import { ACTIONS_TENANT_DAILY, actionQuota } from "./contracts/adapters/action-quota";
import { LINK_CHECKS_PER_MINUTE } from "./contracts/adapters/link-check-limit.redis";
import { pdfSourceText } from "./contracts/adapters/source-file-text";
import { uploadUnavailableRoutes } from "./contracts/adapters/upload.routes";
import type { ExtractionStarter } from "./contracts/application/upload-contract.ports";
import { mountAssistantTools } from "./contracts/assistant.mount";
import { cksModule } from "./contracts/cks/cks.mount";
import { CONTRACTS_KEY, contractsModule } from "./contracts/contracts.mount";
import { type ContractsAiDeps, contractsAiModule } from "./contracts/extraction.mount";
import { type ContractsOverdueDeps, ledgerModule } from "./contracts/ledger.mount";
import { myWorkModule } from "./contracts/mywork.mount";
import { partnersModule } from "./contracts/partners.mount";
import { type ContractsRemindDeps, contractsRemindModule } from "./contracts/reminders.mount";
import { sourcingModule } from "./contracts/sourcing.mount";
import { uploadModule } from "./contracts/upload.mount";
import { packMeRoutes } from "./kit/adapters/me.route";
import { createPackFiles, packFilesRepo } from "./kit/adapters/pack-files.filebox";
import { packFilesRoutes } from "./kit/adapters/pack-files.routes";
import { packGroups } from "./kit/adapters/pack-groups";
import type { PackAccessView } from "./kit/adapters/pack-guard.middleware";
import type { PackToolRegistry } from "./kit/adapters/pack-tools.registry";
import { createPackUow, packTenantOnly } from "./kit/adapters/pack-uow";
import { createPdfConverter } from "./kit/adapters/pdf";
import type { PackRunsBridge } from "./kit/application/pack-runs.ports";
import { PKDEMO_KEY, pkdemoModule } from "./pkdemo/pkdemo.mount";

export const PACK_PREFIX = "/pack";

/** Seam `AppDeps.packs` (test ↔ hub-api). `filebox` dành cho T5f (FileBox `org` theo tenant). `contracts` vắng ⇒ bật (HD1). */
export type PacksDeps = {
  pkdemo?: boolean;
  contracts?: boolean;
  filebox?: { url: string; token: string };
  /** HD2 · agent trích (transport) + tra MST + hook test; M3 · `model` = nhà cung cấp model giả cho AI client chung (null ⇒
   *  chưa cấu hình); vắng ⇒ khoá theo env. */
  contractsAi?: ContractsAiDeps & { model?: ModelProvider | null };
  /** HD4 · vòng nhắc hạn; `worker` vắng ⇒ bật khi `APP_ENV` development/production và `CONTRACTS_REMIND` ≠ off. */
  contractsRemind?: ContractsRemindDeps;
  /** HD7 · vòng quá hạn; `worker` vắng ⇒ bật khi `APP_ENV` development/production và `CONTRACTS_OVERDUE` ≠ off. */
  contractsOverdue?: ContractsOverdueDeps;
  /** R1 · DSN pool riêng của module tri thức (server: `KNOWLEDGE_DATABASE_URL` ‖ `HUB_DATABASE_URL`); vắng ⇒ dùng `db` chung. */
  knowledgeDsn?: string;
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
  if (d.db)
    mountKnowledge(d.db, d.packTools, {
      ...(d.packs?.knowledgeDsn ? { dsn: d.packs.knowledgeDsn } : {}),
      ...(d.signal ? { signal: d.signal } : {}),
    }); // N4 · R1 pool riêng
  if (d.db) setChatUsageSink(chatUsageSink(d.db)); // M3 · usage chat (M2) ⇒ bảng usage chung của AI client
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
  const { model, ...aiDeps } = d.packs?.contractsAi ?? {};
  const tax = aiDeps.tax === undefined ? envTaxRegistry() : aiDeps.tax;
  const ai = contractsAiModule(
    db,
    view,
    { ...aiDeps, tax },
    {
      // M3 · AI client chung (khoá từ env; test tiêm `model` giả) + Group duyệt (admin.groups + cache cấu hình)
      ai: createHubAiClient(db, model === undefined ? {} : { provider: model }),
      groups: packGroups(db, view),
      ...(fb
        ? { fileText: pdfSourceText({ files: fileboxClients(fb), pdf: createPdfConverter() }) }
        : {}),
      ...(d.redis ? { redis: d.redis } : {}),
      quota: actionQuota({
        ...(d.redis ? { redis: d.redis } : {}),
        limit: envInt("CONTRACTS_ACTIONS_TENANT_DAY", ACTIONS_TENANT_DAILY),
        timeZoneOf,
      }),
      tenants: () => packTenants(view, CONTRACTS_KEY),
      ...(d.signal ? { signal: d.signal } : {}),
    },
  );
  // HD1 T7 + T8 (link tệp) · HD5 ngày giá theo múi tenant · HD3 seam duyệt cho PATCH trường (review S1)
  app.route(
    base,
    contractsModule(db, view, fb ? fileboxClients(fb) : null, { timeZoneOf }, ai.guard),
  );
  app.route(base, ai.routes); // HD2
  app.route(base, ai.approval); // HD3
  if (fb)
    app.route(base, contractsUpload(d, view, { db, fb, starter: ai.starter })); // HD1 T10 + HD2 starter
  else app.route(base, uploadUnavailableRoutes(view)); // FileBox vắng ⇒ 503 FILE_STORAGE_UNAVAILABLE (không 404)
  app.route(base, contractsRemind(d, view, db)); // HD4
  app.route(base, cksModule(db, view, { timeZoneOf: tenantTz(d) })); // HD9
  app.route(base, contractsLedger(d, view, db)); // HD7
  app.route(base, myWorkModule(db, view, { timeZoneOf: tenantTz(d) })); // W1 · Việc của tôi
  app.route(base, sourcingModule(db, view, { timeZoneOf: tenantTz(d) })); // W1 · Mua hàng
  app.route(
    base,
    partnersModule(db, view, {
      timeZoneOf: tenantTz(d),
      tax,
      ...(d.redis ? { redis: d.redis } : {}),
      linkChecksPerMinute: envInt("CONTRACTS_LINK_CHECKS_USER_MIN", LINK_CHECKS_PER_MINUTE),
    }),
  ); // HD8
  mountAssistantTools(db, d.packTools, { timeZoneOf: tenantTz(d) }); // M2-chat · tool đọc của trợ lý
}

/** HD7 · sổ thanh toán + vòng quá hạn (tenant có quyền gói — cache, 0 SQL; múi tenant từ `ConfigCache`). */
function contractsLedger(d: PacksMountDeps, view: PackAccessView, db: Db) {
  const o = d.packs?.contractsOverdue ?? {};
  const env = d.appEnv ?? process.env.APP_ENV;
  const worker =
    o.worker ??
    ((env === "development" || env === "production") && process.env.CONTRACTS_OVERDUE !== "off");
  const every = Number(process.env.CONTRACTS_OVERDUE_EVERY_MS);
  return ledgerModule(db, view, {
    ...(Number.isInteger(every) && every >= 1000 ? { everyMs: every } : {}),
    ...o,
    worker,
    timeZoneOf: tenantTz(d),
    tenants: () => packTenants(view, CONTRACTS_KEY),
    ...(d.signal ? { signal: d.signal } : {}),
  });
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
type PackFb = { url: string; token: string; caPath?: string; publicPath?: string };
function packFilebox(p: PacksDeps | undefined): PackFb | null {
  if (p?.filebox) return p.filebox;
  const { FILEBOX_URL: url, FILEBOX_TOKEN: token, FILEBOX_CA: caPath } = process.env;
  const publicPath = process.env.FILEBOX_PUBLIC_PATH?.replace(/\/+$/, "");
  return url && token
    ? { url, token, ...(caPath ? { caPath } : {}), ...(publicPath ? { publicPath } : {}) }
    : null;
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
