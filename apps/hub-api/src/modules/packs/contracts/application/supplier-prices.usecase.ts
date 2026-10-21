// V2-J2 · SP-04/05/06: tab "Nhà cung cấp & giá". `overview` = bảng so sánh + gợi ý (một tx đọc ‖ bảng uy tín NCC V2-E); `search` = AI
// tìm giá trên mạng (CHỈ khi người dùng bấm, CHỈ gửi tên SP, qua AI client gói `ai-sub`, có trần thao tác + trần token); `save` = lưu
// kết quả vào bảng so sánh; `remove`. SP nhóm Giới thiệu không có tab ⇒ 404.

// price-scout: `search` = lượt dò bấm tay của agent Hub `price-scout` (`price-scout.usecase.ts::scout`) — model/lệnh hệ thống ở Hub.
import type { PackUow, PackWho } from "../../kit/application/ports";
import { localDate } from "../domain/local-time.rules";
import { buildOverview, type OverviewData } from "../domain/supplier-advice.rules";
import type {
  SupplierOverviewOut,
  SupplierPriceInput,
  SupplierSearchOut,
} from "../domain/supplier-prices.types";
import { ScoutFail } from "./price-scout.usecase";

export type SuppliersRepo = {
  overview(productId: string): Promise<OverviewData | null>;
  head(
    productId: string,
  ): Promise<{ name: string; group: "service" | "goods" | "referral" } | null>;
  /** null ⇒ SP không có / không thuộc tenant. */
  save(
    productId: string,
    items: SupplierPriceInput[],
    today: string,
  ): Promise<{ ids: string[] } | null>;
  remove(productId: string, priceId: string): Promise<boolean>;
};

export class SupplierFail extends Error {
  constructor(
    readonly kind:
      | "not_found"
      | "unavailable"
      | "cap"
      | "failed"
      | "month_cap"
      | "disabled"
      | "unsupported"
      | "unreadable"
      | "too_large",
  ) {
    super(kind);
  }
}

type Rep = { score: number | null; level: "good" | "fair" | "watch" | "new" };
export type SuppliersDeps = {
  uow: PackUow<{ suppliers: SuppliersRepo }>;
  /** price-scout · lượt dò bấm tay (agent Hub, trần tháng + trần thao tác AI/ngày ở trong). */
  scout: (who: PackWho, productId: string) => Promise<SupplierSearchOut>;
  /** Điểm uy tín vai NCC theo khoá đối tác (V2-E). */
  reputation: (who: PackWho) => Promise<ReadonlyMap<string, Rep>>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now?: () => Date;
};

function suppliersCtx(d: SuppliersDeps) {
  const now = d.now ?? (() => new Date());
  const tx = <T>(who: PackWho, fn: (r: SuppliersRepo) => Promise<T>) =>
    d.uow.tenant(who, (r) => fn(r.suppliers));
  const today = async (who: PackWho) => localDate(now(), await d.timeZoneOf(who.tenantId));
  /** SP có tab này (không phải Giới thiệu) ⇒ tên; ngược lại 404. */
  async function product(who: PackWho, id: string) {
    const h = await tx(who, (r) => r.head(id));
    if (!h || h.group === "referral") throw new SupplierFail("not_found");
    return h;
  }
  return { tx, today, product };
}

/** Lượt dò bấm tay; lỗi dò ⇒ lỗi tab NCC (mã API giữ như V2-J2 + `SCOUT_MONTHLY_CAP`). */
async function searchPrices(
  d: SuppliersDeps,
  who: PackWho,
  id: string,
): Promise<SupplierSearchOut> {
  try {
    return await d.scout(who, id);
  } catch (e) {
    if (!(e instanceof ScoutFail)) throw e;
    if (e.kind === "forbidden") throw e;
    throw new SupplierFail(e.kind);
  }
}

export function suppliersUsecase(d: SuppliersDeps) {
  const c = suppliersCtx(d);
  const { tx, today, product } = c;
  return {
    async overview(who: PackWho, id: string): Promise<SupplierOverviewOut> {
      const [data, scores] = await Promise.all([tx(who, (r) => r.overview(id)), d.reputation(who)]);
      if (!data || data.product.group === "referral") throw new SupplierFail("not_found");
      return buildOverview(data, scores);
    },

    search: (who: PackWho, id: string): Promise<SupplierSearchOut> => searchPrices(d, who, id),

    async save(who: PackWho, id: string, items: SupplierPriceInput[]): Promise<{ ids: string[] }> {
      await product(who, id);
      const day = await today(who);
      const r = await tx(who, (x) => x.save(id, items, day));
      if (!r) throw new SupplierFail("not_found");
      return r;
    },

    async remove(who: PackWho, id: string, priceId: string): Promise<void> {
      if (!(await tx(who, (r) => r.remove(id, priceId)))) throw new SupplierFail("not_found");
    },
  };
}
export type SuppliersUsecase = ReturnType<typeof suppliersUsecase>;
