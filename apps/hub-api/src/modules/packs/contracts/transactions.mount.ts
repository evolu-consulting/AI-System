// CR-101 DOC-deals · nối Giao dịch là chứng từ (lớp 4 của gói; thay G1): tạo giao dịch = `createManual` với `doc_type = 'deal'`
// (không qua duyệt), xác nhận ngay = lệnh xác nhận mốc của sổ HD7/V2-D (kho chạy theo luật giao hàng), lịch sử sửa, lớp tương thích
// đọc `/transactions`. `PackUow` (role `contracts_rw`, RLS tenant + M1). Gắn dưới `/pack/contracts` ở `products.mount.ts`.
import type { Db, Tx } from "@ai/db";
import type { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { dealsRepo } from "./adapters/deals.repo";
import { dealsRoutes } from "./adapters/deals.routes";
import { extractionRepo } from "./adapters/extraction.repo";
import { createManual } from "./application/create-manual.usecase";
import { ledgerCommands } from "./application/ledger.usecase";
import { localDate } from "./domain/local-time.rules";
import { ledgerDeps } from "./ledger.mount";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";
const repos = (tx: Tx, t: string) => ({
  extraction: extractionRepo(tx, t),
  deals: dealsRepo(tx, t),
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
  });
  // Cùng deps với route sổ (repDelta ⇒ delta uy tín lưu như xác nhận thường, cờ v2e).
  const cmd = ledgerCommands(ledgerDeps(db, { timeZoneOf: d.timeZoneOf, now }));
  return dealsRoutes(view, {
    create,
    settle: (w, id) => cmd.settle(w, id, {}),
    milestones: (w, id) => uow.tenant(w, (r) => r.deals.milestones(id)),
    editLog: (w, id, n) => uow.tenant(w, (r) => r.deals.editLog(id, n)),
    legacyList: (w, q) => uow.tenant(w, (r) => r.deals.legacyList(q)),
    legacyDetail: (w, id) => uow.tenant(w, (r) => r.deals.legacyDetail(id)),
  });
}
