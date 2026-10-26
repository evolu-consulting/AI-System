// V2-J2 · nối tab NCC & giá (lớp 4 của gói): `PackUow` (role `contracts_rw`, RLS tenant + luật thấy M1) + repo + use case + route,
// gắn dưới `/pack/contracts` ở `packs.mount.ts`. AI client chung + trần thao tác do `packs.mount.ts` tiêm (cùng bộ với trích HĐ);
// điểm uy tín NCC lấy từ engine HD8 (`partners.mount.ts::supplierScores`, CR-097a).
// price-scout: "Tìm giá trên thị trường" = lượt dò bấm tay của `price-scout.mount.ts` (agent Hub), tiêm qua `scout`.
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import type { AiClient } from "../../../lib/ai-client/ai-client";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow } from "../kit/adapters/pack-uow";
import type { PdfConverter } from "../kit/domain/pdf.rules";
import type { ActionQuota } from "./adapters/action-quota";
import { quoteAi } from "./adapters/quote-read.ai";
import { suppliersRepo } from "./adapters/supplier-prices.repo";
import { supplierPricesRoutes } from "./adapters/supplier-prices.routes";
import { quoteReadUsecase } from "./application/quote-read.usecase";
import { suppliersUsecase } from "./application/supplier-prices.usecase";
import { QUOTE_MODEL } from "./domain/quote-read.rules";

const KEY = "contracts";

export type SupplierPricesDeps = {
  scout: Parameters<typeof suppliersUsecase>[0]["scout"];
  reputation: Parameters<typeof suppliersUsecase>[0]["reputation"];
  timeZoneOf: (tenantId: string) => Promise<string>;
  /** gap-d1 #21 · "Tải báo giá lên": AI client chung (vắng ⇒ 503), PDF → chữ, trần thao tác AI/ngày. */
  quote: { ai: AiClient | null; pdf: PdfConverter; quota: ActionQuota };
  now?: () => Date;
};

export function supplierPricesModule(
  db: Db,
  view: PackAccessView,
  d: SupplierPricesDeps,
): Hono<PackGuardVars> {
  const uow = createPackUow(db, KEY, (tx, t) => ({ suppliers: suppliersRepo(tx, t) }));
  const { quote, ...rest } = d;
  const model = process.env.CONTRACTS_QUOTE_READ_MODEL?.trim() || QUOTE_MODEL;
  return supplierPricesRoutes(view, {
    suppliers: suppliersUsecase({ uow, ...rest }),
    quote: quoteReadUsecase({
      head: (who, id) => uow.tenant(who, (r) => r.suppliers.head(id)),
      ai: quote.ai ? quoteAi(quote.ai, { model }) : null,
      pdf: quote.pdf,
      quota: quote.quota,
      timeZoneOf: d.timeZoneOf,
      ...(d.now ? { now: d.now } : {}),
    }),
  });
}
