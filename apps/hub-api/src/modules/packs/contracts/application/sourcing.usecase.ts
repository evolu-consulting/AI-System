// W1 · "Mua hàng": use case đọc báo cáo nguồn hàng (một trang) + đổi nguồn một dòng bán.
// Dữ liệu THÔ của CẢ tenant nạp một lần và nhớ theo dấu vân tay dữ liệu (`sourcing-cache.ts`); mỗi request: dấu vân tay (tx hệ thống,
// tenant-wide) ‖ tập id HĐ người dùng thấy (SQL trong tx người dùng, RLS tenant + luật thấy M1/M1b) ⇒ lọc dữ liệu thô theo tập đó TRƯỚC khi
// dựng dòng giá (`visibleTo`, review B #9) ⇒ nguồn / lãi / rủi ro / trang trong bộ nhớ. Số câu SQL cố định (trúng: 4 = phạm vi + dấu vân
// tay, phạm vi + id; trượt thêm 3). HĐ không thấy không có mặt và không ảnh hưởng dòng khác; đổi nguồn HĐ không thấy ⇒ 404.
import type { PackSystemUow, PackUow, PackWho } from "../../kit/application/ports";
import { localDate } from "../domain/local-time.rules";
import {
  type FullSale,
  isCandidate,
  type RawSourcing,
  reportOf,
  salesOf,
  visibleTo,
} from "../domain/sourcing.rules";
import {
  SOURCING_PAGE_SIZE,
  type SourceChoice,
  type SourcingOut,
  type SourcingQuery,
} from "../domain/sourcing.types";
import {
  createSourcingCache,
  type SourcingCache,
  type SourcingEntry,
  viewOf,
} from "./sourcing-cache";

export type SourcingRepo = {
  /** Dấu vân tay dữ liệu của CẢ tenant (chạy ở tx hệ thống). */
  fingerprint(): Promise<string>;
  /** HĐ đã duyệt + phụ lục + dòng hàng + lựa chọn của CẢ tenant (tx hệ thống; chỉ khi bộ nhớ đệm trượt). */
  load(): Promise<RawSourcing>;
  /** Id HĐ đã duyệt người dùng thấy (RLS). */
  visibleIds(): Promise<string[]>;
  /** Dòng hàng `ord` của HĐ có tồn tại và người dùng thấy không (RLS). */
  itemExists(contractId: string, line: number): Promise<boolean>;
  setChoice(
    sale: { contract_id: string; line: number },
    src: { contract_id: string; line: number },
  ): Promise<void>;
  clearChoice(sale: { contract_id: string; line: number }): Promise<void>;
};
export type SourcingRepos = { sourcing: SourcingRepo };

export class SourcingFail extends Error {
  constructor(readonly kind: "not_found" | "invalid") {
    super(kind);
  }
}

type Deps = {
  uow: PackUow<SourcingRepos> & PackSystemUow<SourcingRepos>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
  cache?: SourcingCache;
};

/** Dòng bán người dùng THẤY: dữ liệu thô (bộ nhớ đệm theo tenant) lọc theo tập HĐ thấy TRƯỚC khi dựng dòng giá. */
function visibleSalesOf(d: Deps) {
  const cache = d.cache ?? createSourcingCache();
  const dayOf = async (who: PackWho) => localDate(d.now(), await d.timeZoneOf(who.tenantId));

  const entryFor = async (who: PackWho, today: string, fp: string): Promise<SourcingEntry> => {
    const hit = cache.get(who.tenantId);
    if (hit && hit.fp === fp && hit.today === today) return hit;
    return cache.fill(who.tenantId, { fp, today }, () =>
      d.uow.system(who.tenantId, async ({ sourcing: r }) => {
        const fp2 = await r.fingerprint(); // cùng tx với lần nạp ⇒ khớp dữ liệu đọc
        return { fp: fp2, today, raw: await r.load(), views: new Map() };
      }),
    );
  };

  /** Nguồn mua cũng chỉ trong HĐ họ thấy. */
  return async (who: PackWho): Promise<{ rows: FullSale[]; truncated: boolean }> => {
    const today = await dayOf(who);
    const [fp, ids] = await Promise.all([
      d.uow.system(who.tenantId, ({ sourcing: r }) => r.fingerprint()),
      d.uow.tenant(who, ({ sourcing: r }) => r.visibleIds()),
    ]);
    const e = await entryFor(who, today, fp);
    const rows = viewOf(e, ids, () => salesOf(visibleTo(e.raw, ids), e.today));
    return { rows, truncated: e.raw.truncated };
  };
}

export function sourcingUsecases(d: Deps) {
  const visibleSales = visibleSalesOf(d);

  const read = async (who: PackWho, q: SourcingQuery = {}): Promise<SourcingOut> => {
    const size = q.page_size ?? SOURCING_PAGE_SIZE;
    const page = q.page ?? 1;
    const { rows, truncated } = await visibleSales(who);
    const out = reportOf(rows, truncated, {
      ...(q.contract ? { contract: q.contract } : {}),
      q: (q.q ?? "").trim(),
      risk: q.risk === "1",
      limit: size,
      offset: (page - 1) * size,
    });
    return { ...out, page, page_size: size };
  };

  /** `PUT /sourcing/:contract/:line`: nguồn phải là một dòng giá mua của cùng sản phẩm; `contract_id` rỗng ⇒ về chọn tự động. */
  const choose = async (
    who: PackWho,
    contractId: string,
    line: number,
    c: SourceChoice,
  ): Promise<{ ok: true }> => {
    const sale = { contract_id: contractId, line };
    const exists = await d.uow.tenant(who, ({ sourcing: r }) => r.itemExists(contractId, line));
    if (!exists) throw new SourcingFail("not_found");
    if (!c.contract_id) {
      await d.uow.tenant(who, ({ sourcing: r }) => r.clearChoice(sale));
      return { ok: true };
    }
    if (c.line === null || c.line === undefined) throw new SourcingFail("invalid");
    const src = { contract_id: c.contract_id, line: c.line };
    if (!isCandidate((await visibleSales(who)).rows, sale, src)) throw new SourcingFail("invalid");
    await d.uow.tenant(who, ({ sourcing: r }) => r.setChoice(sale, src));
    return { ok: true };
  };
  return { read, choose };
}
export type SourcingUsecases = ReturnType<typeof sourcingUsecases>;
