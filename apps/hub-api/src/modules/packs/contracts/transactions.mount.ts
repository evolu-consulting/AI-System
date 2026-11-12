// CR-101 DOC-deals · nối Giao dịch là chứng từ (lớp 4 của gói; thay G1): tạo giao dịch = `createManual` với `doc_type = 'deal'`
// (không qua duyệt), xác nhận ngay = lệnh xác nhận mốc của sổ HD7/V2-D (kho chạy theo luật giao hàng), lịch sử sửa, lớp tương thích
// đọc `/transactions`. `PackUow` (role `contracts_rw`, RLS tenant + M1). Gắn dưới `/pack/contracts` ở `products.mount.ts`.
import type { Db, Tx } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars, PackWho } from "../kit/public";
import { createPackUow, flowEngine, packTenantOnly } from "../kit/public";
import { type DealsRepo, dealsRepo } from "./adapters/deals.repo";
import { dealsRoutes } from "./adapters/deals.routes";
import { extractionRepo } from "./adapters/extraction.repo";
import { openMilestonesRepo } from "./adapters/open-milestones.repo";
import { EV_TRANSACTION_SAVED, insertTxRequest } from "./adapters/transaction-flow.repo";
import { createManual } from "./application/create-manual.usecase";
import { type FulfillIn, ledgerCommands } from "./application/ledger.usecase";
import { checkDealLink, type LinkRepos, linkToMilestone } from "./application/link-deal.usecase";
import { CONTRACTS_PACK } from "./domain/contract-flow-events.rules";
import { localDate } from "./domain/local-time.rules";
import { ledgerDeps, ledgerRepos, packAdminOf } from "./ledger.mount";
import { safeTimeZone } from "./reminders.mount";
import { bindTransactionEvents } from "./transaction-events.mount";

const KEY = "contracts";
const repos = (tx: Tx, t: string) => ({
  extraction: extractionRepo(tx, t),
  deals: dealsRepo(tx, t),
});
/** CR-127 X2: repo của đường gắn mốc = sổ + kho (cùng `recordFulfillment`) + mốc mở + yêu cầu chờ duyệt. `notify` do `createPackUow` thêm. */
const linkRepos = (tx: Tx, t: string) => ({
  ...ledgerRepos(tx, t),
  om: openMilestonesRepo(tx, t),
  txf: {
    insertRequest: (w: Parameters<LinkRepos["txf"]["insertRequest"]>[0]) =>
      insertTxRequest(tx, t, w),
  },
});

export function transactionsModule(
  db: Db,
  view: PackAccessView,
  d: { timeZoneOf: (tenantId: string) => Promise<string>; now?: () => Date },
): Hono<PackGuardVars> {
  const tz = safeTimeZone(d.timeZoneOf);
  const now = d.now ?? (() => new Date());
  const uow = packTenantOnly(createPackUow(db, KEY, repos));
  const create = createManual({
    uow,
    tax: null,
    newId: () => Bun.randomUUIDv7(),
    today: async (tid) => localDate(now(), await tz(tid)),
    // CR-127 X2: lý do "Không theo hợp đồng" ghi CÙNG tx tạo chứng từ (repo `deals` có trong tx của `repos` ở trên).
    onDeal: (r, id, who, reason) =>
      (r as unknown as { deals: DealsRepo }).deals.unlinkedNote(id, who.userId, reason),
  });
  // Cùng deps với route sổ (repDelta ⇒ delta uy tín lưu như xác nhận thường, cờ v2e).
  const deps = ledgerDeps(db, { timeZoneOf: d.timeZoneOf, now, isAdmin: packAdminOf(view) });
  const cmd = ledgerCommands(deps);
  // CR-127 X2 · `transaction.saved`: bộ đọc dữ kiện + xử lý kết cục thật (thay binding rỗng của flow-unsourced-events).
  bindTransactionEvents(db, deps);
  const link = {
    uow: packTenantOnly(createPackUow(db, KEY, linkRepos)),
    isAdmin: deps.isAdmin,
    fulfill: (w: PackWho, id: string, b: FulfillIn) => cmd.fulfill(w, id, b),
    hasFlow: async (q: { tenantId: string; facts: Record<string, string | number | boolean> }) =>
      (await flowEngine()?.availability.hasFlowFor(null, {
        tenantId: q.tenantId,
        app: CONTRACTS_PACK,
        event: EV_TRANSACTION_SAVED,
        facts: q.facts,
      })) ?? false,
    newId: () => Bun.randomUUIDv7(),
  };
  return dealsRoutes(view, {
    create,
    link: { check: checkDealLink(link), to: linkToMilestone(link) },
    openMilestones: (w, q) => link.uow.tenant(w, (r) => r.om.list(q)),
    settle: (w, id) => cmd.settle(w, id, {}),
    milestones: (w, id) => uow.tenant(w, (r) => r.deals.milestones(id)),
    editLog: (w, id, n) => uow.tenant(w, (r) => r.deals.editLog(id, n)),
    legacyList: (w, q) => uow.tenant(w, (r) => r.deals.legacyList(q)),
    legacyDetail: (w, id) => uow.tenant(w, (r) => r.deals.legacyDetail(id)),
  });
}
