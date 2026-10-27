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
import { fileboxClients, packFilebox } from "../packs.filebox";
import { docusignProvider } from "./adapters/docusign.provider";
import { esignRepo, tenantOfEnvelope } from "./adapters/esign.repo";
import { ESIGN_WEBHOOK_PATH, esignRoutes, esignWebhookRoutes } from "./adapters/esign.routes";
import { selfsignProvider } from "./adapters/esign.selfsign";
import type { ESignFiles, ESignProvider, ESignRegistry } from "./application/esign.ports";
import { type ESignUsecase, esignUsecase } from "./application/esign.usecase";
import { metaOf, providerEntriesOf } from "./domain/esign.providers";
import { docusignConfigOf } from "./domain/esign.rules";

type EnvMap = Record<string, string | undefined>;
const repos = (tx: Tx, t: string) => ({ esign: esignRepo(tx, t) });

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

export function esignModule(
  db: Db,
  d: { esign?: ESignSeam | undefined; files: ESignFiles | null },
): ESignUsecase {
  return esignUsecase({
    providers: registryOf(d.esign),
    uow: createPackUow(db, "contracts", repos),
    files: d.files,
    me: selfContactOf(db),
    tenantOf: tenantOfEnvelope(db),
    newId: () => Bun.randomUUIDv7(),
  });
}

export const esignUserRoutes = (view: PackAccessView, u: ESignUsecase): Hono<PackGuardVars> =>
  esignRoutes(view, u);

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
): ESignUsecase | undefined {
  if (!d.db || !(d.packs?.contracts ?? true)) return undefined;
  const fb = packFilebox(d.packs);
  const u = esignModule(d.db, { esign: d.packs?.esign, files: fb ? fileboxClients(fb) : null });
  app.route(ESIGN_WEBHOOK_PATH, esignWebhookRoutes(u));
  return u;
}
