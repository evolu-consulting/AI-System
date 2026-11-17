// CR-181 · lát s2 · lớp 4 module chữ ký nội bộ: dựng service + mount `/me/signature*` và `/company/signature-*`.
// JWT + tường lửa đối tác gắn ở `app.ts` (PROTECTED_PREFIXES). Quyền quản trị (Q15) qua `CompanyAdminPort` (cổng `packs/kit/public`).
import type { Db } from "@ai/db";
import type { Env, Hono } from "hono";
import type { HubAuditWriter } from "../../lib/hub-audit";
import type { PackAccessView } from "../packs/kit/public";
import { companyAdminPort } from "./adapters/company-admin";
import {
  COMPANY_PREFIX,
  companySignatureRoutes,
  ME_SIGNATURE_PREFIX,
  meSignatureRoutes,
  SIGNATURE_PROTECTED_PREFIXES,
} from "./adapters/signature.routes";
import { signatureStore } from "./adapters/signature.store";
import { SignatureService } from "./application/signature.service";

export { SIGNATURE_PROTECTED_PREFIXES };

export type SignaturesMountDeps = {
  db: Db;
  /** ConfigCache thoả cấu trúc `PackAccessView` (quyền gói của người gọi, 0 SQL khi nóng). */
  view: PackAccessView;
  hubAudit?: HubAuditWriter;
};

export function mountSignatures<E extends Env>(
  app: Hono<E>,
  d: SignaturesMountDeps,
): SignatureService {
  const svc = new SignatureService({
    store: signatureStore(d.db, d.hubAudit),
    admin: companyAdminPort(d.db, d.view),
  });
  app.route(ME_SIGNATURE_PREFIX, meSignatureRoutes(svc));
  app.route(COMPANY_PREFIX, companySignatureRoutes(svc));
  return svc;
}
