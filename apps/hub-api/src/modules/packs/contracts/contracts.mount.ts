// HD-FR-07 · HD1 plan §2 §4 · N1 plan §9: nối gói `contracts` (lớp 4 của gói): `PackUow` (role `contracts_rw`) + use case +
// route. `packs.mount.ts` quyết có mount (`deps.packs.contracts`, vắng ⇒ bật) và gắn dưới `/pack/contracts`; client FileBox
// theo org (`t_<tenant>`) do `packs.mount.ts` tiêm (vắng ⇒ `/file` của HĐ có tệp ⇒ 5xx, fail-closed).

import { CONTRACT_EXPORT_MAX_ROWS } from "@ai/contracts/pack-contracts";
import type { Db } from "@ai/db";
import { probe } from "@ai/db/probe";
import type { Hono } from "hono";
import { logger } from "../../../lib/logger";
import type {
  PackAccessView,
  PackFileboxClient,
  PackGuardVars,
  PackRunsBridge,
  PackWho,
} from "../kit/public";
import {
  checkPackAccess,
  createPackUow,
  memberNamesOf,
  packAccessInput,
  packMembersRoutes,
  packTenantOnly,
} from "../kit/public";
import { appendixRoutes } from "./adapters/appendix.routes";
import { contractRoleOf } from "./adapters/contract-role";
import type { ContractDetailDto } from "./adapters/contracts.mapper";
import { contractsRepos } from "./adapters/contracts.repo";
import { CONTRACTS_KEY, contractsRoutes } from "./adapters/contracts.routes";
import { headOfOwner } from "./adapters/exec-head.repo";
import { visibilityRoutes } from "./adapters/visibility.routes";
import { attachParent, getPrices, suggestParentsFor } from "./application/appendix.usecase";
import { createCategory, listCategories } from "./application/categories.usecase";
import { withDeleteCan } from "./application/detail-delete-role";
import { withExpiryCan } from "./application/detail-expiry-role";
import { withHoldRole } from "./application/detail-hold-role";
import { withSubmitBlock } from "./application/detail-submit-block";
import { holdRoleOk } from "./application/exec-request.usecase";
import { expiryFlowOpen, expiryStateOk } from "./application/expiry-outcome.usecase";
import { exportContracts } from "./application/export-contracts.usecase";
import { type GetContract, getContract } from "./application/get-contract.usecase";
import { getFacets } from "./application/get-facets.usecase";
import { getFileLink } from "./application/get-file-link.usecase";
import { getSource } from "./application/get-source.usecase";
import { listContracts } from "./application/list-contracts.usecase";
import { type StepInfo, waitingOf } from "./application/list-waiting";
import { patchFields } from "./application/patch-fields.usecase";
import { stepLabelOf } from "./domain/approval-step-label.rules";
import { DEFAULT_TENANT_TZ, localDate } from "./domain/local-time.rules";
import { uploadDay } from "./domain/upload.rules";
import { expiryDepsOf } from "./expiry-outcome.mount";

export { CONTRACTS_KEY };

/** CR-116 · điểm đo `probe` (tắt ⇒ gọi thẳng `f`); đặt ở lớp nối vì use case không được import `@ai/db`. */
const timed =
  <A extends unknown[], R>(name: string, f: (...a: A) => Promise<R>) =>
  (...a: A): Promise<R> =>
    probe(name, () => f(...a));

export type ContractsClock = {
  /** Múi giờ tenant (HD4-FR-02: ngày lịch của tenant); vắng ⇒ múi mặc định. `now` để test tiêm. */
  timeZoneOf?: (tenantId: string) => Promise<string>;
  now?: () => Date;
  /** CR-123 · u10 · cầu engine để đặt nhãn cột "Bước" (một lô `stepsViewMany` cho cả trang); vắng ⇒ không có `step_label`. */
  runs?: PackRunsBridge;
  /** CR-127 NF1 · "Gửi sẽ có quy trình khớp?" (= `submitFlowOpen` của lệnh Gửi, dựng ở `contractsAiModule`); vắng ⇒ không có `submit_block`. */
  submitFlowOpen?: (who: PackWho, id: string) => Promise<boolean>;
};

const stepLabelsOf = (runs: PackRunsBridge | undefined) =>
  runs
    ? async (who: PackWho, ids: readonly string[], fromRuns: ReadonlySet<string>) =>
        new Map(
          [
            ...((await runs.port?.stepsViewMany?.({ ...who, role: "member" }, ids)) ?? new Map()),
          ].map(([k, v]) => {
            const label = stepLabelOf(v, fromRuns.has(k));
            return [k, { label, waiting: waitingOf(v, label) } satisfies StepInfo] as const;
          }),
        )
    : undefined;

/** Quyền `admin` của gói (quản trị công ty) theo người gọi — nguồn: cùng `checkPackAccess` của guard. */
const holdAdmin = (view: PackAccessView) => async (who: { tenantId: string; userId: string }) => {
  const i = await packAccessInput(view, CONTRACTS_KEY, { ...who, userKind: "internal" });
  return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
};

export function contractsModule(
  db: Db,
  view: PackAccessView,
  filebox: ((org: string) => Pick<PackFileboxClient, "getLink">) | null = null,
  clock: ContractsClock = {},
): Hono<PackGuardVars> {
  const uow = packTenantOnly(createPackUow(db, CONTRACTS_KEY, contractsRepos));
  const link = filebox ? (org: string, fileId: string) => filebox(org).getLink(fileId) : null;
  // V2-A: ngày lịch tenant cho giai đoạn/quá hạn của mốc (cache múi giờ, 0 SQL khi nóng).
  const dayWith = (fmt: typeof localDate) => async (tid: string) =>
    fmt((clock.now ?? (() => new Date()))(), await (clock.timeZoneOf?.(tid) ?? DEFAULT_TENANT_TZ));
  const today = dayWith(localDate);
  const stepLabels = stepLabelsOf(clock.runs);
  const expiryDeps = expiryDepsOf(db, { today, isAdmin: holdAdmin(view) });
  const sfo = clock.submitFlowOpen;
  const blockErr = (e: unknown) =>
    logger.warn("contracts-submit-block-failed", {
      error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
    });
  const withBlock = (g: GetContract<ContractDetailDto>) =>
    sfo ? withSubmitBlock(g, sfo, blockErr) : g;
  const r = contractsRoutes(view, {
    list: timed(
      "contracts.list",
      listContracts({
        uow,
        today,
        roleOf: contractRoleOf(view),
        ...(stepLabels ? { stepLabels } : {}),
      }),
    ),
    facets: getFacets({ uow }),
    export: exportContracts({
      uow,
      today,
      timeZoneOf: async (tid) => clock.timeZoneOf?.(tid) ?? DEFAULT_TENANT_TZ,
      owners: memberNamesOf(db),
      cap: CONTRACT_EXPORT_MAX_ROWS,
    }),
    // CR-127 X3 · R#18: `can.hold/release` cộng vai trưởng phòng của người phụ trách + quản trị công ty (chỉ tra khi trạng thái cho phép nút).
    // CR-127 SG1 · BR-68: `can.expiry` (kết cục hiệu lực bằng tay) — vai như hold + công ty không có quy trình `contract.expiring` khớp.
    // CR-127 NF1: `submit_block` (Gửi bị chặn vì chưa có quy trình duyệt khớp) — chỉ HĐ DRAFT mới hỏi engine.
    detail: timed(
      "contracts.detail",
      withBlock(
        withDeleteCan(
          withExpiryCan(
            withHoldRole(getContract({ uow, today }), (who, c) =>
              holdRoleOk({ headOf: headOfOwner(db), isAdmin: holdAdmin(view) }, who, c),
            ),
            {
              stateOk: expiryStateOk,
              roleOk: expiryDeps.roleOk,
              flowOpen: expiryFlowOpen(expiryDeps),
            },
          ),
          contractRoleOf(view),
        ),
      ),
    ),
    source: getSource({ uow }),
    fileLink: getFileLink({ packKey: CONTRACTS_KEY, uow, link, log: logger }),
    patchFields: patchFields({ uow }),
  });
  r.route(
    "/",
    appendixRoutes(view, CONTRACTS_KEY, {
      listCategories: listCategories({ uow }),
      createCategory: createCategory({ uow }),
      attachParent: attachParent({ uow }),
      suggestParents: suggestParentsFor({ uow }),
      prices: getPrices({ uow }),
      today: dayWith(uploadDay),
    }),
  );
  r.route("/", visibilityRoutes(view, CONTRACTS_KEY, db)); // M1D-FR-04: chế độ thấy (tenant|org)
  r.route("/", packMembersRoutes(view, CONTRACTS_KEY, db)); // HD5 · N1 Q8: danh bạ tên người phụ trách
  // T10 (tải lên): `upload.mount.ts`, gắn ở `packs.mount.ts` (cần Redis + FileBox + múi tenant mà module này không nhận).
  return r;
}
