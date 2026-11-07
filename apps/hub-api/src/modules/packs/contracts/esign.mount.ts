// cf-esign-docusign + esign-multi · nối ký số: registry nhà cung cấp theo env `ESIGN_PROVIDERS` (danh sách theo thứ tự; tương thích
// ngược `ESIGN_PROVIDER=x`), mỗi nhà cung cấp khả dụng khi đủ cấu hình — seam test `provider`/`providers` ưu tiên; repo trong `PackUow`
// (tenant + system), FileBox theo org tenant, tên/email user hiện tại (`admin.users` qua hub scope), map webhook envelope ⇒ tenant (role
// `contracts_job`). Webhook gắn TRƯỚC JWT (`app.ts`). Thêm nhà cung cấp (MISA…) = adapter + một nhánh `adapterOf` + mục `PROVIDER_META`.

import { ESignSignerSchema, type ESignStatus } from "@ai/contracts/pack-contracts";
import { packFeatureKey } from "@ai/contracts/packs";
import type { Db, Tx } from "@ai/db";
import type { Env, Hono } from "hono";
import { logger } from "../../../lib/logger";
import type { Redis } from "../../../lib/redis";
import type { PackAccessView, PackGuardVars, PackWho, PdfConverter } from "../kit/public";
import {
  createPackUow,
  createPdfConverter,
  moduleRegistry,
  packStreamPublish,
  selfContactOf,
} from "../kit/public";
import { fileboxClients, packFilebox } from "../packs.filebox";
import { docusignProvider } from "./adapters/docusign.provider";
import { esignRepo, tenantOfEnvelope } from "./adapters/esign.repo";
import { ESIGN_WEBHOOK_PATH, esignRoutes, esignWebhookRoutes } from "./adapters/esign.routes";
import { selfsignProvider } from "./adapters/esign.selfsign";
import { esignAnchorRepo } from "./adapters/esign-anchor.repo";
import { esignAnchorRoutes } from "./adapters/esign-anchor.routes";
import { activeUserOf, deptHeadOf, esignFlowRepo, packWriters } from "./adapters/esign-flow.repo";
import { esignFlowRoutes } from "./adapters/esign-flow.routes";
import { esignNodeDirectory } from "./adapters/esign-node.repo";
import { escalateTargetsOf, esignSweepRepo } from "./adapters/esign-sweep.repo";
import { esignSyncClaim } from "./adapters/esign-sync.repo";
import type { ESignFiles, ESignProvider, ESignRegistry } from "./application/esign.ports";
import { type ESignUsecase, esignUsecase } from "./application/esign.usecase";
import { esignAnchors } from "./application/esign-anchor.usecase";
import { type EsignFlow, esignFlow } from "./application/esign-flow.usecase";
import { type EsignSweepDeps, startEsignSweeper } from "./application/esign-sweep";
import { type EsignSyncDeps, esignSyncEnv } from "./application/esign-sync";
import { metaOf, providerEntriesOf } from "./domain/esign.providers";
import { docusignConfigOf } from "./domain/esign.rules";
import { type ESignEvent, esignEventOf } from "./domain/esign-event.rules";
import { esignBindingChecks } from "./nodes/esign/binding";

type EnvMap = Record<string, string | undefined>;
const repos = (tx: Tx, t: string) => ({ esign: esignRepo(tx, t), esignFlow: esignFlowRepo(tx, t) });

/** Adapter của nhà cung cấp KHẢ DỤNG (đã kiểm ở `providerEntriesOf`). */
function adapterOf(key: string, env: EnvMap): ESignProvider | null {
  if (key === "selfsign") return selfsignProvider();
  if (key === "docusign") {
    const cfg = docusignConfigOf(env);
    return cfg ? docusignProvider(cfg) : null;
  }
  return null;
}

/** Env ⇒ registry; nhà cung cấp liệt kê mà thiếu cấu hình ⇒ không khả dụng + cảnh báo (không lộ giá trị). */
export function envESignRegistry(env: EnvMap): ESignRegistry {
  const entries = providerEntriesOf(env);
  const byKey = new Map<string, ESignProvider>();
  for (const e of entries) {
    const p = e.available ? adapterOf(e.key, env) : null;
    if (p) byKey.set(e.key, p);
    else logger.warn("esign-provider-not-configured", { provider: e.key });
  }
  return {
    entries: entries.map((e) => ({ ...e, available: byKey.has(e.key) })),
    get: (k) => byKey.get(k) ?? null,
  };
}

/** Seam test: danh sách adapter (đều khả dụng, theo thứ tự). */
export function staticESignRegistry(ps: readonly ESignProvider[]): ESignRegistry {
  return {
    entries: ps.map((p) => ({ key: p.key, ...metaOf(p.key, p.demo), available: true })),
    get: (k) => ps.find((p) => p.key === k) ?? null,
  };
}

export type ESignSeam = { provider?: ESignProvider | null; providers?: ESignProvider[] };

const registryOf = (s: ESignSeam | undefined): ESignRegistry => {
  if (s?.providers) return staticESignRegistry(s.providers);
  if (s && s.provider !== undefined) return staticESignRegistry(s.provider ? [s.provider] : []);
  return envESignRegistry(process.env);
};

/** esign-flow · use case ký số + bước Ký số của luồng duyệt (gắn hai chiều: gửi ký ⇄ hook trạng thái phong bì). */
export type ESignModule = ESignUsecase & {
  flow: EsignFlow;
  /** esign-flow-fix · gắn kiểm quyền ghi gói của người ký công ty (cần cổng quyền của `packs.mount`). */
  bindWriters(w: Writers): void;
  bindView(view: PackAccessView): void;
  /** CR-120 · G6 · CR-122 E3 · phong bì sang trạng thái CUỐI ⇒ gọi hook với khoá sự kiện (`esign.completed|declined|voided`) — gói bắn
   *  cho lượt đang chờ; lỗi hook không làm hỏng đồng bộ. */
  bindCompleted(
    fn: (tenantId: string, contractId: string, event: ESignEvent) => Promise<unknown>,
  ): void;
  /** esign-sweep · bật vòng nền bước Ký số (một lần; tắt ngoài dev/prod hoặc `CONTRACTS_ESIGN_SWEEP=off`). */
  startSweep(view: PackAccessView): void;
};

export function esignModule(
  db: Db,
  d: {
    esign?: ESignSeam | undefined;
    files: ESignFiles | null;
    signal?: AbortSignal | undefined;
    /** CR-125 · x6 · đẩy `esign.updated` tới người liên quan qua `/me/stream` (vắng ⇒ không đẩy; client vẫn tải lại khi quay lại cửa sổ). */
    publish?:
      | ((userIds: string[], contractId: string, status: ESignStatus) => Promise<void>)
      | undefined;
  },
): ESignModule {
  const uow = createPackUow(db, "contracts", repos);
  let flow: EsignFlow | null = null;
  let completed:
    | ((tenantId: string, contractId: string, event: ESignEvent) => Promise<unknown>)
    | null = null;
  const providers = registryOf(d.esign);
  /** Đổi trạng thái phong bì ⇒ báo người gửi + người ký (lỗi đẩy không làm hỏng luồng ký). */
  const push = async (tid: string, id: string, st: ESignStatus): Promise<void> => {
    if (!d.publish) return;
    await uow
      .system(tid, (r) => r.esign.watchers(id))
      .then((ids) => (ids.length > 0 ? d.publish?.(ids, id, st) : undefined))
      .catch((e: unknown) =>
        logger.warn("esign-push-failed", {
          contract_id: id,
          error: e instanceof Error ? e.name : "unknown",
        }),
      );
  };
  const u = esignUsecase({
    changed: push,
    providers,
    uow,
    files: d.files,
    me: selfContactOf(db),
    tenantOf: tenantOfEnvelope(db),
    newId: () => Bun.randomUUIDv7(),
    // esign-anchor · vị trí ô ký trong văn bản HĐ (PDF không có `source_text` ⇒ đọc lớp chữ; worker tạo lười khi cần).
    anchors: esignAnchors({
      uow: createPackUow(db, "contracts", (tx: Tx, t: string) => ({
        anchor: esignAnchorRepo(tx, t),
      })),
      files: d.files,
      pdf: lazyPdf(2),
      // esign-anchor-fix · xem trước (quyền read) dùng worker/hàng chờ RIÊNG ⇒ gọi dồn không làm lần gửi thật bị PDF_BUSY.
      previewPdf: lazyPdf(1),
    }),
    directory: esignNodeDirectory(db), // CR-122 · E5
    onStatus: async (tid, id, st) => {
      await push(tid, id, st);
      await flow?.onStatus(tid, id, st);
      const ev = esignEventOf(st);
      if (ev)
        await completed?.(tid, id, ev).catch((e: unknown) =>
          logger.warn("esign-completed-hook-failed", {
            contract_id: id,
            error: e instanceof Error ? e.name : "unknown",
          }),
        );
    },
    warn: (m, meta) => logger.warn(m, meta),
  });
  // CR-122 · E5b · lưu def có node Ký số ⇒ server tự kiểm cấu hình (validator theo node, `processes/defs` gọi).
  // E5d · theo KHOÁ TOOL (không chỉ theo node): def gọi thẳng `contracts-esign-send` không mang `node` cũng bị kiểm.
  moduleRegistry.bindNode(esignBindingChecks(u.checkNode)); // CR-125 · m4 · binding Ký số (nodes/esign/binding.ts) — validator theo khoá tool
  // esign-flow-fix · quyền ghi gói của người ký (cổng quyền cần cache cấu hình ⇒ gắn sau ở `packs.mount`).
  let writers: Writers | null = null;
  const active = activeUserOf(db);
  flow = esignFlow({
    uow,
    send: u.sendSystem,
    deptHead: deptHeadOf(db),
    signerOk: async (t, uid) =>
      (await active(t, uid)) &&
      (writers ? (await writers({ tenantId: t, userId: uid }, [uid])).has(uid) : true),
    parsePartner: (name, email) => {
      const p = ESignSignerSchema.safeParse({ role: "partner", name, email });
      return p.success && p.data.role === "partner"
        ? { name: p.data.name, email: p.data.email }
        : null;
    },
    warn: (m, meta) => logger.warn(m, meta),
  });
  const bindWriters = (w: Writers) => {
    writers = w;
  };
  return {
    ...u,
    flow,
    bindWriters,
    bindCompleted: (fn) => {
      completed = fn;
    },
    bindView: (v) => bindWriters(packWriters(db, v, "contracts")),
    startSweep: esignSweepStarter(db, d.signal, esignSyncOf(db, providers, u), u.expireOpen),
  };
}
type Writers = (who: PackWho, ids: readonly string[]) => Promise<ReadonlySet<string>>;

/** esign-sweep · phụ thuộc vòng nền bước Ký số (test gọi `sweepEsignOnce` trực tiếp với đồng hồ giả). */
export function esignSweepDeps(
  db: Db,
  tenants: () => Promise<readonly string[]>,
  sync?: EsignSyncDeps,
  expire?: EsignSweepDeps["expire"],
): EsignSweepDeps {
  return {
    ...(sync ? { sync } : {}),
    ...(expire ? { expire } : {}), // CR-122 · E5c
    uow: createPackUow(db, "contracts", (tx: Tx, t: string) => ({
      esignSweep: esignSweepRepo(tx, t),
    })),
    tenants,
    escalateTo: escalateTargetsOf(db),
    warn: (m, meta) => logger.warn(m, meta),
  };
}

/** Tenant có entitlement `contracts-read` (cache cấu hình, 0 SQL) — như `packTenants` của `packs.mount`. */
async function contractsTenants(view: PackAccessView): Promise<string[]> {
  const cat = await view.catalog();
  const f = cat.features.find((x) => x.key === packFeatureKey("contracts", "read"));
  if (!f) return [];
  const suffix = `:${f.id}`;
  return [...cat.entitled].filter((e) => e.endsWith(suffix)).map((e) => e.slice(0, -suffix.length));
}

/** esign-sweep · vòng nền mỗi `CONTRACTS_ESIGN_SWEEP_EVERY_MS` (mặc định 5'); chỉ ở `APP_ENV` development/production và
 *  `CONTRACTS_ESIGN_SWEEP` ≠ off (test gọi `sweepEsignOnce` trực tiếp). Trả hàm bật một lần khi có cổng quyền (`view`). */
function esignSweepStarter(
  db: Db,
  signal: AbortSignal | undefined,
  sync: EsignSyncDeps,
  expire: EsignSweepDeps["expire"],
) {
  let started = false;
  return (view: PackAccessView) => {
    const env = process.env.APP_ENV;
    const on =
      (env === "development" || env === "production") &&
      process.env.CONTRACTS_ESIGN_SWEEP !== "off";
    if (started || !on) return;
    started = true;
    const every = Number(process.env.CONTRACTS_ESIGN_SWEEP_EVERY_MS);
    startEsignSweeper({
      ...esignSweepDeps(db, () => contractsTenants(view), sync, expire),
      everyMs: Number.isInteger(every) && every >= 1000 ? every : 300_000,
      ...(signal ? { signal } : {}),
    });
  };
}

/** esign-sweep2 · pha đồng bộ nền: chọn phong bì của nhà cung cấp KHẢ DỤNG không demo (MỘT câu, role `contracts_job`) rồi đồng bộ qua
 *  đường webhook/làm mới (`syncEnvelope`). Giới hạn theo env `CONTRACTS_ESIGN_SYNC_MAX` / `CONTRACTS_ESIGN_SYNC_MIN`. */
export function esignSyncOf(
  db: Db,
  providers: ESignRegistry,
  u: Pick<ESignUsecase, "syncEnvelope">,
  env: Record<string, string | undefined> = process.env,
): EsignSyncDeps {
  const keys = providers.entries
    .filter((e) => e.available && providers.get(e.key)?.demo === false)
    .map((e) => e.key);
  return {
    ...esignSyncEnv(env),
    claim: esignSyncClaim(db, () => keys),
    run: u.syncEnvelope,
  };
}

const lazyPdf = (maxPending: number): Pick<PdfConverter, "toText"> => {
  let c: PdfConverter | null = null;
  return {
    toText: (b, o) => {
      c ??= createPdfConverter({ maxPending });
      return c.toText(b, o);
    },
  };
};

/** Route ký số + esign-anchor (cụm/ô ký) + esign-flow "Gửi lại" bước Ký số. */
export const esignUserRoutes = (view: PackAccessView, u: ESignModule): Hono<PackGuardVars> => {
  u.bindView(view); // esign-flow-fix · người ký công ty còn quyền ghi gói (cổng quyền theo cache cấu hình)
  u.startSweep(view); // esign-sweep · kẹt gửi / nhắc / quá hạn bước Ký số (vòng nền, tắt được)
  const r = esignRoutes(view, u);
  if (u.anchors) r.route("/", esignAnchorRoutes(view, u.anchors));
  return r.route("/", esignFlowRoutes(view, u.flow));
};

/** CR-125 · x6 · đẩy `esign.updated` qua cổng kit (không import hub trực tiếp). */
const streamOf =
  (redis: Redis) =>
  (userIds: string[], contractId: string, status: ESignStatus): Promise<void> =>
    packStreamPublish(redis, logger)(userIds, {
      event: "esign.updated",
      data: { contract_id: contractId, status },
    });

/** Gắn webhook `/pack/contracts/esign/webhook/:provider` — gọi TRƯỚC `requireAuth` (không JWT; nhà cung cấp tự xác thực) — và
 *  trả use case dùng chung cho route người dùng. Gói contracts tắt / không db ⇒ undefined. */
export function mountEsignWebhook<E extends Env>(
  app: Hono<E>,
  d: {
    db?: Db | undefined;
    signal?: AbortSignal | undefined;
    redis?: Redis | undefined;
    packs?:
      | {
          contracts?: boolean;
          filebox?: { url: string; token: string };
          esign?: ESignSeam;
        }
      | undefined;
  },
): ESignModule | undefined {
  if (!d.db || !(d.packs?.contracts ?? true)) return undefined;
  const fb = packFilebox(d.packs);
  const u = esignModule(d.db, {
    esign: d.packs?.esign,
    files: fb ? fileboxClients(fb) : null,
    signal: d.signal,
    publish: d.redis ? streamOf(d.redis) : undefined,
  });
  app.route(ESIGN_WEBHOOK_PATH, esignWebhookRoutes(u));
  return u;
}
