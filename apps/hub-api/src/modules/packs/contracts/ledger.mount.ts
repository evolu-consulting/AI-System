// HD7-FR-03…10 · HD7-FR-09 · HD7 plan §2–§4 (lớp 4 của gói): nối sổ thanh toán — `PackUow` (role `contracts_rw`, RLS tenant) + repo +
// use case + route; vòng quá hạn (`PackSystemUow` theo tenant) chỉ khi `worker`: `drain` chạy tới hết việc rồi mới trả ⇒ `startLoop`
// chỉ ngủ giữa các lượt (mặc định 1 giờ như `connectors/poll.py`). Múi tenant qua `safeTimeZone` của HD4 (không nhân bản).
import type { Db, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { logger } from "../../../lib/logger";
import { startLoop } from "../../../lib/loop";
import type { PackAccessView, PackGuardVars, PackWho } from "../kit/public";
import {
  checkPackAccess,
  createPackUow,
  memberNamesOf,
  packAccessInput,
  packTenantOnly,
} from "../kit/public";
import { deliveryRepo } from "./adapters/delivery.repo";
import { deliveryRoutes } from "./adapters/delivery.routes";
import { execRequestsRoutes } from "./adapters/exec-requests.routes";
import { expiryOutcomeRoutes } from "./adapters/expiry-outcome.routes";
import { ledgerRoutes } from "./adapters/ledger.routes";
import { ledgerReadRepo } from "./adapters/ledger-read.repo";
import { ledgerWriteRepo } from "./adapters/ledger-write.repo";
import { milestonesRepo } from "./adapters/milestones.repo";
import { milestonesRoutes } from "./adapters/milestones.routes";
import { obligationImpactRoutes } from "./adapters/obligation-impact.routes";
import { overdueRepo } from "./adapters/overdue.repo";
import { penaltyRepo } from "./adapters/penalty.repo";
import { penaltyRoutes } from "./adapters/penalty.routes";
import { repRepo } from "./adapters/rep.repo";
import { rowsOf } from "./adapters/rep.sql";
import { deliveryReads } from "./application/delivery.usecase";
import { execCommands } from "./application/exec-request.usecase";
import { expiryCommands } from "./application/expiry-outcome.usecase";
import type { LockedObligation } from "./application/ledger.ports";
import { ledgerCommands, ledgerReads } from "./application/ledger.usecase";
import { milestoneCommands } from "./application/milestones.usecase";
import { v2eDeltaIn } from "./application/obligation-impact.usecase";
import { createOverdueSweepUsecase, type OverdueSweep } from "./application/overdue-sweep";
import { penaltyCommands } from "./application/penalty.usecase";
import { CONTRACTS_PACK } from "./domain/contract-flow-events.rules";
import { localDate } from "./domain/local-time.rules";
import { bindExecRequestEvents, execDepsOf } from "./exec-request-events.mount";
import { expiryDepsOf } from "./expiry-outcome.mount";
import { obligationImpactOf } from "./obligation-impact.mount";
import { safeTimeZone } from "./reminders.mount";
import { envRepEngine } from "./rep-current.mount";

export type { OverdueSweep };

const KEY = "contracts";
export const OVERDUE_BATCH = 500;
const DEFAULT_EVERY_MS = 3_600_000;

export const ledgerRepos = (tx: Tx, t: string) => ({
  ledger: { ...ledgerWriteRepo(tx, t), ...ledgerReadRepo(tx, t) },
  milestones: milestonesRepo(tx, t), // V2-A · HD-11
  delivery: deliveryRepo(tx, t), // V2-D · HD-05 (mốc giao ⇒ kho)
  rep: repRepo(tx, t), // MS-impact · delta uy tín V2-E trong tx xác nhận
  /** MS-impact · Luật 4c: câu chấm V2-E lập kế hoạch ~25 ms; kế hoạch CHUNG (một lần mỗi kết nối) cho riêng đoạn chấm trong tx. */
  planGeneric: async (on: boolean) => {
    await tx.execute(
      sql`select set_config('plan_cache_mode', ${on ? "force_generic_plan" : "auto"}, true)`,
    );
  },
});
type TxRepos = ReturnType<typeof ledgerRepos>;
const deltaIn = v2eDeltaIn(rowsOf);

export type OverdueSweepDeps = {
  timeZoneOf: (tenantId: string) => Promise<string>;
  tenants: () => Promise<readonly string[]>;
  now?: () => Date;
  batchSize?: number;
};

/** Vòng quá hạn (test gọi trực tiếp `once`/`drain` với đồng hồ giả). */
export function createOverdueSweep(db: Db, d: OverdueSweepDeps): OverdueSweep {
  const uow = createPackUow(db, KEY, (tx, tid) => ({ overdue: overdueRepo(tx, tid) }));
  return createOverdueSweepUsecase({
    uow: { system: (tid, fn) => uow.system(tid, fn) },
    tenants: d.tenants,
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    now: d.now ?? (() => new Date()),
    batchSize: d.batchSize ?? OVERDUE_BATCH,
    log: logger,
  });
}

/** Seam `PacksDeps.contractsOverdue`: `worker` ⇒ dựng vòng nền. */
export type ContractsOverdueDeps = { worker?: boolean; everyMs?: number };

/** Deps chung của lệnh sổ (route sổ HD7 + "đã giao/đã thanh toán ngay" của giao dịch — DOC-deals): cùng `repDelta` ⇒ xác nhận ở
 *  đâu cũng lưu delta uy tín như nhau (cờ `v2e`). */
/** CR-127 X5: quyền `admin` của gói (quản trị công ty) theo người gọi — cùng `checkPackAccess` của guard. */
export const packAdminOf = (view: PackAccessView) => async (who: PackWho) => {
  const i = await packAccessInput(view, KEY, { ...who, userKind: "internal" });
  return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
};

export function ledgerDeps(
  db: Db,
  d: {
    timeZoneOf: (tenantId: string) => Promise<string>;
    now: () => Date;
    isAdmin?: (who: PackWho) => Promise<boolean>;
  },
) {
  const tz = safeTimeZone(d.timeZoneOf);
  return {
    ...(d.isAdmin ? { isAdmin: d.isAdmin } : {}),
    uow: packTenantOnly(createPackUow(db, KEY, ledgerRepos)),
    timeZoneOf: tz,
    now: d.now,
    // Cờ `hd8` ⇒ không lưu (HD8 đọc cả tenant theo vai — phá ngưỡng V2-D); `v2e` ⇒ 4 câu trong tx, lọc một đối tác.
    repDelta: async (
      who: { tenantId: string },
      repos: unknown,
      q: { head: LockedObligation; at: string; fault: "partner" | "ours" | "unknown" | null },
    ) =>
      envRepEngine() === "v2e"
        ? deltaIn(repos as TxRepos, { ...q, today: localDate(d.now(), await tz(who.tenantId)) })
        : null,
  };
}

export function ledgerModule(
  db: Db,
  view: PackAccessView,
  d: OverdueSweepDeps & ContractsOverdueDeps & { signal?: AbortSignal },
): Hono<PackGuardVars> {
  if (d.worker) {
    const s = createOverdueSweep(db, d);
    startLoop({
      name: "contracts-overdue",
      everyMs: d.everyMs ?? DEFAULT_EVERY_MS,
      tick: () => s.drain(),
      log: logger,
      ...(d.signal ? { signal: d.signal } : {}),
    });
  }
  const now = d.now ?? (() => new Date());
  // MS-impact: xem trước tác động + delta uy tín lưu trên dòng sổ khi xác nhận (engine hiện hành).
  const impact = obligationImpactOf(db, { timeZoneOf: d.timeZoneOf, now });
  const deps = ledgerDeps(db, { timeZoneOf: d.timeZoneOf, now, isAdmin: packAdminOf(view) });
  // CR-127 X3: tạm khoá/mở khoá + yêu cầu thay đổi thực hiện (một bảng `exec_requests`); `fulfilment.change_requested` có binding thật.
  const execDeps = execDepsOf(db, { timeZoneOf: d.timeZoneOf, now });
  const exec = execCommands(execDeps);
  bindExecRequestEvents(db, execDeps);
  const r = ledgerRoutes(view, {
    cmd: ledgerCommands(deps),
    reads: ledgerReads(deps),
    engine: envRepEngine, // REP-v3: cờ `v2e` ⇒ đóng chỉnh tay ±10
    exec,
    names: memberNamesOf(db), // CR-127 SG1: tên người giữ việc (`task.claimed_by_name`, `TASK_CLAIMED.details.by_name`)
  });
  // CR-127 SG1 · BR-68: kết cục hiệu lực của HĐ sắp hết hạn bằng tay (cùng logic kết cục của quy trình `contract.expiring`).
  r.route(
    "/",
    expiryOutcomeRoutes(
      view,
      expiryCommands(expiryDepsOf(db, { today: execDeps.today, isAdmin: packAdminOf(view) })),
    ),
  );
  r.route("/", milestonesRoutes(view, milestoneCommands({ uow: deps.uow }), exec)); // V2-A · thêm/sửa/xoá mốc (X3: HĐ DONE ⇒ yêu cầu thay đổi)
  r.route("/", execRequestsRoutes(view, exec)); // CR-127 X3
  // CR-127 X4: phạt chậm — `POST /obligations/:id/penalty` (Ghi vào công nợ / Miễn phạt), `GET /contracts/:id/penalties` (ước tính)
  const penalty = penaltyCommands({
    uow: packTenantOnly(
      createPackUow(db, CONTRACTS_PACK, (tx, tid) => ({ penalty: penaltyRepo(tx, tid) })),
    ),
    today: execDeps.today,
    headOf: execDeps.headOf,
  });
  r.route("/", penaltyRoutes(view, penalty));
  r.route("/", deliveryRoutes(view, deliveryReads({ uow: deps.uow }))); // V2-D · bảng SL mốc giao + kiểm tồn
  r.route("/", obligationImpactRoutes(view, impact)); // MS-impact · xem trước tác động xác nhận mốc
  return r;
}
