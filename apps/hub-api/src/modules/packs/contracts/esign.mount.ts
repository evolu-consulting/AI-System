// cf-esign-docusign · nối ký số: chọn nhà cung cấp theo env `ESIGN_PROVIDER` (none | selfsign | docusign; mặc định none = tắt) — seam
// test `provider` ưu tiên; repo trong `PackUow` (tenant + system), FileBox theo org tenant, tên/email user hiện tại (`admin.users` qua
// hub scope), map webhook envelope ⇒ tenant (role `contracts_job`). Webhook gắn TRƯỚC JWT (`app.ts`).
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
import type { ESignFiles, ESignProvider } from "./application/esign.ports";
import { type ESignUsecase, esignUsecase } from "./application/esign.usecase";
import { docusignConfigOf, esignKindOf } from "./domain/esign.rules";

const repos = (tx: Tx, t: string) => ({ esign: esignRepo(tx, t) });

/** Env ⇒ nhà cung cấp; docusign thiếu biến ⇒ null + cảnh báo (không lộ giá trị). */
export function envESignProvider(env: Record<string, string | undefined>): ESignProvider | null {
  const kind = esignKindOf(env);
  if (kind === "selfsign") return selfsignProvider();
  if (kind !== "docusign") return null;
  const cfg = docusignConfigOf(env);
  if (!cfg) logger.warn("esign-docusign-not-configured", {});
  return cfg ? docusignProvider(cfg) : null;
}

export function esignModule(
  db: Db,
  d: { provider?: ESignProvider | null | undefined; files: ESignFiles | null },
): ESignUsecase {
  return esignUsecase({
    provider: d.provider === undefined ? envESignProvider(process.env) : d.provider,
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
          esign?: { provider: ESignProvider | null };
        }
      | undefined;
  },
): ESignUsecase | undefined {
  if (!d.db || !(d.packs?.contracts ?? true)) return undefined;
  const fb = packFilebox(d.packs);
  const u = esignModule(d.db, {
    ...(d.packs?.esign ? { provider: d.packs.esign.provider } : {}),
    files: fb ? fileboxClients(fb) : null,
  });
  app.route(ESIGN_WEBHOOK_PATH, esignWebhookRoutes(u));
  return u;
}
