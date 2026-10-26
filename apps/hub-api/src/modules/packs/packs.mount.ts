// PK-FR-05 Â· PK-FR-09 Â· D-09 Â· N1 plan Â§9 Â· lá»›p 4 cá»§a module gÃ³i (gá»™p mount tá»‘i thiá»ƒu T5b `app.packs.ts`): `GET /pack/<k>/me`
// + route nghiá»‡p vá»¥ tá»«ng gÃ³i dÆ°á»›i `/pack/<k>`. Chá»— DUY NHáº¤T ná»‘i `modules/config` (ConfigCache thoáº£ cá»•ng `PackAccessView`) vÃ o
// module gÃ³i. JWT á»Ÿ gá»‘c: `PACK_PREFIX` náº±m trong `PROTECTED_PREFIXES` cá»§a `app.ts` (401 trÆ°á»›c 404). GÃ³i `pkdemo` (D-08) chá»‰
// ngoÃ i production: `deps.packs.pkdemo` Æ°u tiÃªn, váº¯ng â‡’ `pkdemoEnabled(appEnv)` (review m-04: chá»‰ khi khai bÃ¡o rÃµ dev/test).
import { packFeatureKey } from "@ai/contracts";
import type { Db } from "@ai/db";
import type { Env, Hono } from "hono";
import { createAgentCaller } from "../../lib/ai-client/agent-call";
import type { ModelProvider } from "../../lib/ai-client/ai-client";
import { createHubAiClient } from "../../lib/ai-client/ai-client.env";
import { chatUsageSink } from "../../lib/ai-client/chat-usage.sink";
import { logger } from "../../lib/logger";
import type { Redis } from "../../lib/redis";
import { createTaxRegistry, taxBaseUrl } from "../../lib/tax-registry.http";
import { agentSpecOf } from "../agents/agent-spec.service";
import { FileboxClient } from "../attachments/filebox.client";
import { envFileboxToken } from "../attachments/filebox-token";
import { DEFAULT_TENANT_TZ } from "../config/config.rules";
import type { ConfigCache } from "../config/config.service";
import { mountGuide } from "../guide/guide.mount";
import { mountKnowledge } from "../knowledge/knowledge.mount";
import { mountMyHistory } from "../my-history/my-history.mount";
import { setChatUsageSink } from "../usage/chat-usage";
import { contractsActivitySource } from "./contracts/activity.mount";
import { ACTIONS_TENANT_DAILY, actionQuota } from "./contracts/adapters/action-quota";
import { LINK_CHECKS_PER_MINUTE } from "./contracts/adapters/link-check-limit.redis";
import { pdfSourceText } from "./contracts/adapters/source-file-text";
import { uploadUnavailableRoutes } from "./contracts/adapters/upload.routes";
import type { ExtractionStarter } from "./contracts/application/upload-contract.ports";
import { mountAssistantTools } from "./contracts/assistant.mount";
import { businessModule } from "./contracts/business.mount";
import { cksModule } from "./contracts/cks/cks.mount";
import { companyModule } from "./contracts/company.mount";
import { mountContractsContext } from "./contracts/context.mount";
import { CONTRACTS_KEY, contractsModule } from "./contracts/contracts.mount";
import { deleteContractModule } from "./contracts/delete-contract.mount";
import { type ContractsAiDeps, contractsAiModule } from "./contracts/extraction.mount";
import { type ContractsOverdueDeps, ledgerModule } from "./contracts/ledger.mount";
import { manageModule } from "./contracts/manage.mount";
import { myWorkModule } from "./contracts/mywork.mount";
import { partnersModule } from "./contracts/partners.mount";
import { priceScoutModule } from "./contracts/price-scout.mount";
import { productsModule } from "./contracts/products.mount";
import { type ContractsRemindDeps, contractsRemindModule } from "./contracts/reminders.mount";
import { reputationModule, supplierScores } from "./contracts/reputation.mount";
import { serviceCustomersModule } from "./contracts/service-customers.mount";
import { sourcingModule } from "./contracts/sourcing.mount";
import { supplierPricesModule } from "./contracts/supplier-prices.mount";
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

/** Seam `AppDeps.packs` (test â†” hub-api). `filebox` dÃ nh cho T5f (FileBox `org` theo tenant). `contracts` váº¯ng â‡’ báº­t (HD1). */
export type PacksDeps = {
  pkdemo?: boolean;
  contracts?: boolean;
  filebox?: { url: string; token: string };
  /** HD2 Â· agent trÃ­ch (transport) + tra MST + hook test; M3 Â· `model` = nhÃ  cung cáº¥p model giáº£ cho AI client chung (null â‡’
   *  chÆ°a cáº¥u hÃ¬nh); váº¯ng â‡’ khoÃ¡ theo env. */
  contractsAi?: ContractsAiDeps & { model?: ModelProvider | null };
  /** HD4 Â· vÃ²ng nháº¯c háº¡n; `worker` váº¯ng â‡’ báº­t khi `APP_ENV` development/production vÃ  `CONTRACTS_REMIND` â‰  off. */
  contractsRemind?: ContractsRemindDeps;
  /** HD7 Â· vÃ²ng quÃ¡ háº¡n; `worker` váº¯ng â‡’ báº­t khi `APP_ENV` development/production vÃ  `CONTRACTS_OVERDUE` â‰  off. */
  contractsOverdue?: ContractsOverdueDeps;
  /** price-scout Â· vÃ²ng dÃ² giÃ¡ theo lá»‹ch; `worker` váº¯ng â‡’ báº­t khi `APP_ENV` development/production vÃ  `CONTRACTS_PRICE_SCOUT` â‰  off. */
  contractsPriceScout?: { worker?: boolean };
  /** R1 Â· DSN pool riÃªng cá»§a module tri thá»©c (server: `KNOWLEDGE_DATABASE_URL` â€– `HUB_DATABASE_URL`); váº¯ng â‡’ dÃ¹ng `db` chung. */
  knowledgeDsn?: string;
};

export type PacksMountDeps = {
  db?: Db;
  config: ConfigCache;
  appEnv?: "development" | "test" | "production";
  packs?: PacksDeps;
  /** HD1 T10 Â· bá»™ Ä‘áº¿m quota táº£i lÃªn (D-17). */
  redis?: Redis;
  /** N2-FR-01 Â· cáº§u khá»Ÿi cháº¡y run quy trÃ¬nh (engine gáº¯n khi mount). */
  packRuns?: PackRunsBridge;
  /** N2-FR-03 Â· registry tool gÃ³i (dÃ¹ng chung vá»›i engine + `/mcp`). */
  packTools?: PackToolRegistry;
  /** HD4 Â· dá»«ng vÃ²ng nháº¯c khi server táº¯t. */
  signal?: AbortSignal;
};

/** Review m-04 Â· `pkdemo` chá»‰ má»Ÿ khi `APP_ENV` khai bÃ¡o rÃµ `development`/`test`; váº¯ng hoáº·c giÃ¡ trá»‹ láº¡ â‡’ táº¯t (fail-closed). */
export const pkdemoEnabled = (appEnv: string | undefined): boolean =>
  appEnv === "development" || appEnv === "test";

/** Gáº¯n `/pack/*` (gá»i sau khi Ä‘Ã£ gáº¯n `requireAuth`); tráº£ cá»•ng quyá»n gÃ³i. */
export function mountPacks<E extends Env>(app: Hono<E>, d: PacksMountDeps): PackAccessView {
  const view: PackAccessView = d.config;
  d.packTools?.bindView(view, (m, meta) => logger.warn(m, meta)); // N2-FR-03 Â· gÃ³i báº­t theo cache guard
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
    }); // N4 Â· R1 pool riÃªng
  if (d.db) {
    mountCoreTools({ ...d, db: d.db }, view);
    setChatUsageSink(chatUsageSink(d.db)); // M3 Â· usage chat (M2) â‡’ báº£ng usage chung cá»§a AI client
  }
  rejectToolCollisions(d);
  return view;
}

/** Tool lÃµi chá»‰ Ä‘á»c (khÃ´ng entitlement, tá»± lá»c theo ngÆ°á»i gá»i): app-guide + my-activity / my-chat-history (my-activity-rag). */
function mountCoreTools(d: PacksMountDeps & { db: Db }, view: PackAccessView): void {
  mountGuide(d.db, d.packTools, view);
  const contractsOn = d.packs?.contracts ?? true;
  mountMyHistory(d.db, d.packTools, {
    view,
    timeZoneOf: tenantTz(d),
    sources: contractsOn ? [contractsActivitySource(d.db)] : [],
  });
}

/** Security L1 Â· sau khi má»i gÃ³i Ä‘Äƒng kÃ½: tool gÃ³i trÃ¹ng khoÃ¡ workflow catalog bá»‹ gá»¡ (áº£nh catalog Ä‘áº§u tiÃªn, cache). */
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

/** HD1 (Ä‘á»c/sá»­a, táº£i lÃªn) + HD2 (trÃ­ch, nháº­p tay) + HD3 (flow duyá»‡t trÃªn engine: starter, tool gÃ³i, quÃ©t, tráº§n thao tÃ¡c). */
function mountContracts<E extends Env>(
  app: Hono<E>,
  d: PacksMountDeps & { db: Db },
  view: PackAccessView,
  fb: PackFb | null,
): void {
  const cx = contractsCtx(d, view, fb);
  for (const t of cx.ai.tools) d.packTools?.register(t); // contract-flow S3a · tool engine duyệt HĐ (cờ bật)
  mountContractsCore(app, cx);
  mountContractsMore(app, cx);
  mountAssistantTools(d.db, d.packTools, { timeZoneOf: tenantTz(d) }); // M2-chat Â· tool Ä‘á»c cá»§a trá»£ lÃ½
  mountContractsContext(d.db, d.packTools); // one-agent Â· nhÃ£n HÄ/Ä‘á»‘i tÃ¡c Ä‘ang xem (khá»‘i ngá»¯ cáº£nh dock)
}

type ContractsCtx = ReturnType<typeof contractsCtx>;

/** Phá»¥ thuá»™c chung cá»§a gÃ³i contracts: AI client (M3), tra MST, tráº§n thao tÃ¡c, module trÃ­ch HD2/HD3. */
function contractsCtx(d: PacksMountDeps & { db: Db }, view: PackAccessView, fb: PackFb | null) {
  const db = d.db;
  const base = `${PACK_PREFIX}/${CONTRACTS_KEY}`;
  const timeZoneOf = async (tid: string) =>
    (await d.config.tenant(tid))?.timezone ?? DEFAULT_TENANT_TZ;
  const { model, ...aiDeps } = d.packs?.contractsAi ?? {};
  const tax = aiDeps.tax === undefined ? envTaxRegistry() : aiDeps.tax;
  const aiClient = createHubAiClient(db, model === undefined ? {} : { provider: model }); // M3 Â· dÃ¹ng chung trÃ­ch HÄ + V2-I tÃ¬m web
  const quota = actionQuota({
    ...(d.redis ? { redis: d.redis } : {}),
    limit: envInt("CONTRACTS_ACTIONS_TENANT_DAY", ACTIONS_TENANT_DAILY),
    timeZoneOf,
  });
  const ai = contractsAiModule(
    db,
    view,
    { ...aiDeps, tax },
    {
      // M3 Â· AI client chung (khoÃ¡ tá»« env; test tiÃªm `model` giáº£) + Group duyá»‡t (admin.groups + cache cáº¥u hÃ¬nh)
      ai: aiClient,
      groups: packGroups(db, view, CONTRACTS_KEY),
      ...(fb
        ? { fileText: pdfSourceText({ files: fileboxClients(fb), pdf: createPdfConverter() }) }
        : {}),
      ...(d.redis ? { redis: d.redis } : {}),
      quota,
      ...(d.packRuns ? { engine: d.packRuns } : {}), // contract-flow S3a · duyệt trên engine (cờ CONTRACTS_APPROVAL_ENGINE)
      tenants: () => packTenants(view, CONTRACTS_KEY),
      ...(d.signal ? { signal: d.signal } : {}),
      timeZoneOf, // V2-A Â· ngÃ y lá»‹ch tenant cho má»‘c máº·c Ä‘á»‹nh
    },
  );
  return { d, db, view, fb, base, timeZoneOf, tax, aiClient, quota, ai };
}

function mountContractsCore<E extends Env>(app: Hono<E>, cx: ContractsCtx): void {
  const { d, db, view, fb, base, timeZoneOf, ai } = cx;
  // HD1 T7 + T8 (link tá»‡p) Â· HD5 ngÃ y giÃ¡ theo mÃºi tenant Â· HD3 seam duyá»‡t cho PATCH trÆ°á»ng (review S1)
  app.route(
    base,
    contractsModule(db, view, fb ? fileboxClients(fb) : null, { timeZoneOf, guard: ai.guard }),
  );
  app.route(base, ai.routes); // HD2
  app.route(base, manageModule(db, view, { ai: cx.aiClient, quota: cx.quota })); // gap-a1 · giao/hoa hồng/lịch sử/tóm tắt
  app.route(base, ai.approval); // HD3
  if (fb)
    app.route(base, contractsUpload(d, view, { db, fb, starter: ai.starter })); // HD1 T10 + HD2 starter
  else app.route(base, uploadUnavailableRoutes(view)); // FileBox váº¯ng â‡’ 503 FILE_STORAGE_UNAVAILABLE (khÃ´ng 404)
  app.route(base, contractsRemind(d, view, db)); // HD4
  app.route(base, cksModule(db, view, { timeZoneOf: tenantTz(d) })); // HD9
  app.route(base, contractsLedger(d, view, db)); // HD7
  app.route(
    base,
    myWorkModule(db, view, {
      timeZoneOf: tenantTz(d),
      ...(ai.myApprovals ? { approvals: ai.myApprovals } : {}), // contract-flow S3b
    }),
  ); // W1 Â· Viá»‡c cá»§a tÃ´i
  app.route(base, sourcingModule(db, view, { timeZoneOf: tenantTz(d) })); // W1 Â· Mua hÃ ng
  app.route(base, productsModule(db, view, { timeZoneOf })); // V2-B Â· danh má»¥c SP + kho
  app.route(base, businessModule(db, view, { timeZoneOf: tenantTz(d) })); // V2-J1 Â· Ä‘iá»ƒm kinh doanh SP
  app.route(base, serviceCustomersModule(db, view, { timeZoneOf: tenantTz(d) })); // V2-H Â· khÃ¡ch Ä‘ang dÃ¹ng
  app.route(base, deleteContractModule(db, view, { timeZoneOf: tenantTz(d) })); // V2-M Â· xoÃ¡ HÄ
}

function mountContractsMore<E extends Env>(app: Hono<E>, cx: ContractsCtx): void {
  const { d, db, view, base, timeZoneOf, tax, aiClient } = cx;
  const scout = contractsPriceScout(cx); // price-scout Â· agent Hub + cáº¥u hÃ¬nh + vÃ²ng dÃ² theo lá»‹ch
  app.route(base, scout.routes);
  app.route(
    base,
    supplierPricesModule(db, view, {
      scout: scout.scout,
      timeZoneOf,
      reputation: supplierScores(db, { timeZoneOf }),
      quote: { ai: aiClient, pdf: createPdfConverter(), quota: cx.quota }, // gap-d1 #21 · tải báo giá lên
    }),
  ); // V2-J2 Â· tab NCC & giÃ¡ (thay /cks/scans)
  app.route(base, companyModule(db, view)); // V2-L Â· cÃ i Ä‘áº·t cÃ´ng ty + cá» duyá»‡t
  app.route(
    base,
    partnersModule(db, view, {
      timeZoneOf: tenantTz(d),
      tax,
      ai: aiClient,
      ...(d.redis ? { redis: d.redis } : {}),
      linkChecksPerMinute: envInt("CONTRACTS_LINK_CHECKS_USER_MIN", LINK_CHECKS_PER_MINUTE),
    }),
  ); // HD8 (engine cÅ© chá»‰ Ä‘á»c â€” CR-096 Q1)
  app.route(base, contractsReputation(d, view, db)); // V2-E Â· uy tÃ­n v2
}
/** price-scout Â· agent Hub `price-scout` qua cá»•ng `AgentCaller` (AI client chung + cáº¥u hÃ¬nh agent Hub/Studio); vÃ²ng dÃ² theo lá»‹ch
 *  báº­t cÃ¹ng Ä‘iá»u kiá»‡n vÃ²ng nháº¯c HD4 (`worker`, `CONTRACTS_PRICE_SCOUT` â‰  off). */
function contractsPriceScout(cx: ContractsCtx) {
  const { d, db, view, timeZoneOf, aiClient, quota } = cx;
  const env = d.appEnv ?? process.env.APP_ENV;
  const worker =
    d.packs?.contractsPriceScout?.worker ??
    ((env === "development" || env === "production") &&
      process.env.CONTRACTS_PRICE_SCOUT !== "off");
  const every = Number(process.env.CONTRACTS_PRICE_SCOUT_EVERY_MS);
  return priceScoutModule(db, view, {
    agents: createAgentCaller(aiClient, agentSpecOf(db)),
    quota,
    timeZoneOf,
    tenants: () => packTenants(view, CONTRACTS_KEY),
    worker,
    ...(Number.isInteger(every) && every >= 1000 ? { everyMs: every } : {}),
    ...(d.signal ? { signal: d.signal } : {}),
  });
}

/** HD7 Â· sá»• thanh toÃ¡n + vÃ²ng quÃ¡ háº¡n (tenant cÃ³ quyá»n gÃ³i â€” cache, 0 SQL; mÃºi tenant tá»« `ConfigCache`). */
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

/** V2-E Â· uy tÃ­n v2 + vÃ²ng chá»‘t thÃ¡ng (báº­t cÃ¹ng Ä‘iá»u kiá»‡n vÃ²ng quÃ¡ háº¡n HD7: `worker`, `CONTRACTS_OVERDUE` â‰  off). */
function contractsReputation(d: PacksMountDeps, view: PackAccessView, db: Db) {
  const env = d.appEnv ?? process.env.APP_ENV;
  const worker =
    d.packs?.contractsOverdue?.worker ??
    ((env === "development" || env === "production") && process.env.CONTRACTS_OVERDUE !== "off");
  return reputationModule(db, view, {
    worker,
    timeZoneOf: tenantTz(d),
    tenants: () => packTenants(view, CONTRACTS_KEY),
    ...(d.signal ? { signal: d.signal } : {}),
  });
}

/** BR-6 (HD9) Â· mÃºi giá» tenant tá»« `ConfigCache` (0 SQL khi nÃ³ng), váº¯ng â‡’ máº·c Ä‘á»‹nh. */
const tenantTz = (d: PacksMountDeps) => async (tid: string) =>
  (await d.config.tenant(tid))?.timezone ?? DEFAULT_TENANT_TZ;

/** HD4 Â· nháº¯c háº¡n + káº¿t quáº£ xá»­ lÃ½; mÃºi tenant tá»« `ConfigCache` (0 SQL). Test báº­t vÃ²ng báº±ng `packs.contractsRemind.worker`. */
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

/** Env sá»‘ nguyÃªn dÆ°Æ¡ng, sai/váº¯ng â‡’ máº·c Ä‘á»‹nh. */
const envInt = (k: string, def: number): number => {
  const n = Number(process.env[k]);
  return Number.isInteger(n) && n > 0 ? n : def;
};

/** HD3 Â· tenant cÃ³ entitlement `<k>-read` (cache cáº¥u hÃ¬nh, 0 SQL) â€” táº­p quÃ©t cá»§a vÃ²ng flow duyá»‡t. */
async function packTenants(view: PackAccessView, key: string): Promise<string[]> {
  const cat = await view.catalog();
  const f = cat.features.find((x) => x.key === packFeatureKey(key, "read"));
  if (!f) return [];
  const suffix = `:${f.id}`;
  return [...cat.entitled].filter((e) => e.endsWith(suffix)).map((e) => e.slice(0, -suffix.length));
}

/** HD2 Â· tra MST Cá»¥c Thuáº¿ (egress `lib/`, gÃ³i khÃ´ng gá»i HTTP): `CONTRACTS_TAX_LOOKUP_URL` váº¯ng/sai â‡’ khÃ´ng tra. */
function envTaxRegistry() {
  const base = taxBaseUrl(process.env.CONTRACTS_TAX_LOOKUP_URL);
  return base ? createTaxRegistry({ baseUrl: base, log: logger }) : null;
}

/** HD1 T10 Â· táº£i lÃªn: Redis = `deps.redis` (váº¯ng â‡’ 503, D-17); mÃºi tenant tá»« `ConfigCache` (D-16, 0 SQL má»—i request). */
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

/** Client FileBox theo org `t_<tenant>` (má»—i lá»i gá»i má»™t org, PK-FR-06). */
function fileboxClients(fb: PackFb) {
  const token = envFileboxToken(fb.token);
  return (org: string) =>
    new FileboxClient({ ...fb, org, token, timeoutMs: 10_000, retryDelaysMs: [200], log: logger });
}

/** T5f Â· FileBox cá»§a gÃ³i: `deps.packs.filebox` Æ°u tiÃªn, váº¯ng â‡’ env FB1 (`FILEBOX_URL` + `FILEBOX_TOKEN`, CA `FILEBOX_CA`). */
type PackFb = { url: string; token: string; caPath?: string; publicPath?: string };
function packFilebox(p: PacksDeps | undefined): PackFb | null {
  if (p?.filebox) return p.filebox;
  const { FILEBOX_URL: url, FILEBOX_TOKEN: token, FILEBOX_CA: caPath } = process.env;
  const publicPath = process.env.FILEBOX_PUBLIC_PATH?.replace(/\/+$/, "");
  return url && token
    ? { url, token, ...(caPath ? { caPath } : {}), ...(publicPath ? { publicPath } : {}) }
    : null;
}

/** T5f Â· route file gÃ³i `/files/:id/content` â€” client FileBox dá»±ng theo org `t_<tenant>` má»—i lá»i gá»i (PK-FR-06). */
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
