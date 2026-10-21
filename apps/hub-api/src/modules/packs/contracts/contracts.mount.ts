// HD-FR-07 · HD1 plan §2 §4 · N1 plan §9: nối gói `contracts` (lớp 4 của gói): `PackUow` (role `contracts_rw`) + use case +
// route. `packs.mount.ts` quyết có mount (`deps.packs.contracts`, vắng ⇒ bật) và gắn dưới `/pack/contracts`; client FileBox
// theo org (`t_<tenant>`) do `packs.mount.ts` tiêm (vắng ⇒ `/file` của HĐ có tệp ⇒ 5xx, fail-closed).
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import { logger } from "../../../lib/logger";
import { packMembersRoutes } from "../kit/adapters/members.route";
import type { PackFileboxClient } from "../kit/adapters/pack-files.filebox";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { appendixRoutes } from "./adapters/appendix.routes";
import { contractsRepos } from "./adapters/contracts.repo";
import { CONTRACTS_KEY, contractsRoutes } from "./adapters/contracts.routes";
import { visibilityRoutes } from "./adapters/visibility.routes";
import { attachParent, getPrices, suggestParentsFor } from "./application/appendix.usecase";
import { createCategory, listCategories } from "./application/categories.usecase";
import { getContract } from "./application/get-contract.usecase";
import { getFacets } from "./application/get-facets.usecase";
import { getFileLink } from "./application/get-file-link.usecase";
import { getSource } from "./application/get-source.usecase";
import { listContracts } from "./application/list-contracts.usecase";
import { type PatchApprovalGuard, patchFields } from "./application/patch-fields.usecase";
import { DEFAULT_TENANT_TZ, localDate } from "./domain/local-time.rules";
import { uploadDay } from "./domain/upload.rules";

export { CONTRACTS_KEY };

export type ContractsClock = {
  /** Múi giờ tenant (HD4-FR-02: ngày lịch của tenant); vắng ⇒ múi mặc định. `now` để test tiêm. */
  timeZoneOf?: (tenantId: string) => Promise<string>;
  now?: () => Date;
  /** HD3 · review S1: seam duyệt cho PATCH trường (giai đoạn run + mở lại duyệt); vắng ⇒ hành vi HD1. */
  guard?: PatchApprovalGuard;
};

export function contractsModule(
  db: Db,
  view: PackAccessView,
  filebox: ((org: string) => Pick<PackFileboxClient, "getLink">) | null = null,
  clock: ContractsClock = {},
): Hono<PackGuardVars> {
  const { guard } = clock;
  const uow = packTenantOnly(createPackUow(db, CONTRACTS_KEY, contractsRepos));
  const link = filebox ? (org: string, fileId: string) => filebox(org).getLink(fileId) : null;
  // V2-A: ngày lịch tenant cho giai đoạn/quá hạn của mốc (cache múi giờ, 0 SQL khi nóng).
  const today = async (tid: string) =>
    localDate(
      (clock.now ?? (() => new Date()))(),
      await (clock.timeZoneOf?.(tid) ?? DEFAULT_TENANT_TZ),
    );
  const r = contractsRoutes(view, {
    list: listContracts({ uow, today }),
    facets: getFacets({ uow }),
    detail: getContract({ uow, today }),
    source: getSource({ uow }),
    fileLink: getFileLink({ packKey: CONTRACTS_KEY, uow, link, log: logger }),
    patchFields: patchFields({ uow, ...(guard ? { approval: guard } : {}) }),
  });
  r.route(
    "/",
    appendixRoutes(view, CONTRACTS_KEY, {
      listCategories: listCategories({ uow }),
      createCategory: createCategory({ uow }),
      attachParent: attachParent({ uow }),
      suggestParents: suggestParentsFor({ uow }),
      prices: getPrices({ uow }),
      today: async (tid) =>
        uploadDay(
          (clock.now ?? (() => new Date()))(),
          await (clock.timeZoneOf?.(tid) ?? DEFAULT_TENANT_TZ),
        ),
    }),
  );
  r.route("/", visibilityRoutes(view, CONTRACTS_KEY, db)); // M1D-FR-04: chế độ thấy (tenant|org)
  r.route("/", packMembersRoutes(view, CONTRACTS_KEY, db)); // HD5 · N1 Q8: danh bạ tên người phụ trách
  // T10 (tải lên): `upload.mount.ts`, gắn ở `packs.mount.ts` (cần Redis + FileBox + múi tenant mà module này không nhận).
  return r;
}
