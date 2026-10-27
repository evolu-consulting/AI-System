// cf-esign-docusign + esign-multi · nối ký số: registry nhà cung cấp theo env `ESIGN_PROVIDERS` (danh sách theo thứ tự; tương thích
// ngược `ESIGN_PROVIDER=x`), mỗi nhà cung cấp khả dụng khi đủ cấu hình — seam test `provider`/`providers` ưu tiên; repo trong `PackUow`
// (tenant + system), FileBox theo org tenant, tên/email user hiện tại (`admin.users` qua hub scope), map webhook envelope ⇒ tenant (role
// `contracts_job`). Webhook gắn TRƯỚC JWT (`app.ts`). Thêm nhà cung cấp (MISA…) = adapter + một nhánh `adapterOf` + mục `PROVIDER_META`.
import type { Db, Tx } from "@ai/db";
import type { Env, Hono } from "hono";
import { logger } from "../../../lib/logger";
import { selfContactOf } from "../kit/adapters/member-names";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow } from "../kit/adapters/pack-uow";
import { createPdfConverter } from "../kit/adapters/pdf";
import type { PdfConverter } from "../kit/domain/pdf.rules";
import { fileboxClients, packFilebox } from "../packs.filebox";
import { docusignProvider } from "./adapters/docusign.provider";
import { esignRepo, tenantOfEnvelope } from "./adapters/esign.repo";
import { ESIGN_WEBHOOK_PATH, esignRoutes, esignWebhookRoutes } from "./adapters/esign.routes";
import { selfsignProvider } from "./adapters/esign.selfsign";
import { esignAnchorRepo } from "./adapters/esign-anchor.repo";
import { esignAnchorRoutes } from "./adapters/esign-anchor.routes";
import { deptHeadOf, esignFlowRepo } from "./adapters/esign-flow.repo";
import { esignFlowRoutes } from "./adapters/esign-flow.routes";
import type { ESignFiles, ESignProvider, ESignRegistry } from "./application/esign.ports";
import { type ESignUsecase, esignUsecase } from "./application/esign.usecase";
import { esignAnchors } from "./application/esign-anchor.usecase";
import { type EsignFlow, esignFlow } from "./application/esign-flow.usecase";
import { metaOf, providerEntriesOf } from "./domain/esign.providers";
import { docusignConfigOf } from "./domain/esign.rules";

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
export type ESignModule = ESignUsecase & { flow: EsignFlow };

export function esignModule(
  db: Db,
  d: { esign?: ESignSeam | undefined; files: ESignFiles | null },
): ESignModule {
  const uow = createPackUow(db, "contracts", repos);
  let flow: EsignFlow | null = null;
  const u = esignUsecase({
    providers: registryOf(d.esign),
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
      pdf: lazyPdf(),
    }),
    onStatus: async (tid, id, st) => flow?.onStatus(tid, id, st),
  });
  flow = esignFlow({
    uow,
    send: u.sendSystem,
    deptHead: deptHeadOf(db),
    warn: (m, meta) => logger.warn(m, meta),
  });
  return { ...u, flow };
}

const lazyPdf = (): Pick<PdfConverter, "toText"> => {
  let c: PdfConverter | null = null;
  return {
    toText: (b, o) => {
      c ??= createPdfConverter({ maxPending: 1 });
      return c.toText(b, o);
    },
  };
};

/** Route ký số + esign-anchor (cụm/ô ký) + esign-flow "Gửi lại" bước Ký số. */
export const esignUserRoutes = (view: PackAccessView, u: ESignModule): Hono<PackGuardVars> => {
  const r = esignRoutes(view, u);
  if (u.anchors) r.route("/", esignAnchorRoutes(view, u.anchors));
  return r.route("/", esignFlowRoutes(view, u.flow));
};

/** Gắn webhook `/pack/contracts/esign/webhook/:provider` — gọi TRƯỚC `requireAuth` (không JWT; nhà cung cấp tự xác thực) — và
 *  trả use case dùng chung cho route người dùng. Gói contracts tắt / không db ⇒ undefined. */
export function mountEsignWebhook<E extends Env>(
  app: Hono<E>,
  d: {
    db?: Db | undefined;
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
  const u = esignModule(d.db, { esign: d.packs?.esign, files: fb ? fileboxClients(fb) : null });
  app.route(ESIGN_WEBHOOK_PATH, esignWebhookRoutes(u));
  return u;
}
