// HD-FR-93 · HD-FR-95 · HD-FR-96 · BR-4 · BR-6: use case ĐỌC CKS — một tx RLS, MỘT câu SQL nghiệp vụ mỗi request (Luật 4c);
// gom/tính ở domain. "Hôm nay" theo múi giờ tenant. Khách tenant khác / không có ⇒ `null` (route trả 404).
import type { PackWho } from "../../../kit/application/ports";
import { likePattern } from "../../domain/fold.rules";
import { briefCustomer, type CustomerFilter, groupCustomers } from "../domain/customers.rules";
import { cksPackages, type PkgFilter } from "../domain/prices.rules";
import { todayIn } from "../domain/sale.rules";
import type { CksClock, CksUow } from "./ports";

export class CksFail extends Error {
  constructor(
    readonly kind: "not_found" | "stock" | "serial" | "renewal_open" | "renewal_closed" | "dates",
  ) {
    super(kind);
    this.name = "CksFail";
  }
}

export type CksReadDeps = { uow: CksUow; clock: CksClock };

const today = async (d: CksReadDeps, who: PackWho) =>
  todayIn(d.clock.now(), await d.clock.timeZoneOf(who.tenantId));

export function cksReads(d: CksReadDeps) {
  return {
    overview: async (who: PackWho) => {
      const day = await today(d, who);
      return d.uow.tenant(who, (r) => r.cks.overview(day));
    },
    /** Một trang khách: câu 1 chọn id theo lọc/tìm/sắp, câu 2 lấy chữ ký của đúng các khách đó (HD9-AC09). */
    customers: async (
      who: PackWho,
      f: CustomerFilter & { q?: string; page: number; page_size: number },
    ) => {
      const day = await today(d, who);
      const { page, rows } = await d.uow.tenant(who, async (r) => {
        const pg = await r.cks.customerPage({
          today: day,
          ...(f.filter ? { filter: f.filter } : {}),
          ...(f.lot ? { lot: f.lot } : {}),
          ...(f.ca ? { ca: f.ca } : {}),
          like: `%${likePattern(f.q ?? "")}%`,
          size: f.page_size,
          offset: (f.page - 1) * f.page_size,
        });
        return { page: pg, rows: pg.ids.length ? await r.cks.liveCerts(pg.ids) : [] };
      });
      const by = new Map(groupCustomers(rows, day).map((c) => [c.company_id, c]));
      const items = page.ids.flatMap((id) => {
        const c = by.get(id);
        return c ? [briefCustomer(c)] : [];
      });
      return { items, total: page.total, page: f.page, page_size: f.page_size, cas: page.cas };
    },
    customer: async (who: PackWho, id: string) => {
      const day = await today(d, who);
      const rows = await d.uow.tenant(who, (r) => r.cks.liveCerts([id]));
      return groupCustomers(rows, day)[0] ?? null;
    },
    lots: (who: PackWho) => d.uow.tenant(who, (r) => r.cks.lots()),
    prices: async (who: PackWho, filter: PkgFilter) => {
      const day = await today(d, who);
      const i = await d.uow.tenant(who, (r) => r.cks.priceInputs());
      return cksPackages(i.lots, i.sold, i.market, day, filter);
    },
    signedDocs: (
      who: PackWho,
      q: { customer_id: string; certificate_id?: string; kind?: string },
    ) =>
      // M1c (review A-1): khách không thấy được ⇒ [] — điều kiện nằm trong CÙNG câu của repo (HD9-AC09 khoá: 1 câu nghiệp vụ;
      // tenant khác ⇒ `[]`, không 404); RLS `cks_signed_docs_visible` lọc thêm từng văn bản.
      d.uow.tenant(who, (r) => r.cks.signedDocs(q)),
  };
}
export type CksReads = ReturnType<typeof cksReads>;
