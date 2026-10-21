// gap-d1 #18 · "Nhập lô" tay của SP: một tx RLS của người gọi — tìm thành phần (mặc định: thành phần chính có kho) ⇒ `applyDelivery`
// với dòng nhập lý do `manual` (không HĐ). Chỉ thành phần `stock`/`quota`; luật kho (BQ, FIFO, hạn gói) do `planDelivery`.
import type { PackUow, PackWho } from "../../kit/application/ports";
import { localDate } from "../domain/local-time.rules";
import type { ProductLotCreate, ProductLotResultOut } from "../domain/products.types";
import { type DeliveryMove, type DeliveryResult, StockError } from "../domain/stock.rules";

export type LotsRepo = {
  /** null ⇒ SP / thành phần không có (hoặc SP không có thành phần có kho). */
  resolve(
    productId: string,
    componentId: string | null,
    supplier: { name: string; tax_id?: string | null | undefined } | null,
  ): Promise<{ component_id: string; mode: string; party_key: string | null } | null>;
  receive(move: DeliveryMove, on: string): Promise<DeliveryResult>;
};

export class LotFail extends Error {
  constructor(
    readonly kind: "not_found" | "invalid",
    detail: string = kind,
  ) {
    super(detail);
  }
}

export type LotsDeps = {
  uow: PackUow<{ lots: LotsRepo }>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now?: () => Date;
};

export function lotsUsecase(d: LotsDeps) {
  const now = d.now ?? (() => new Date());
  return {
    async add(who: PackWho, productId: string, b: ProductLotCreate): Promise<ProductLotResultOut> {
      const today = localDate(now(), await d.timeZoneOf(who.tenantId));
      const on = b.received_on ?? today;
      if (on > today) throw new LotFail("invalid", "ngày nhập ở tương lai");
      try {
        return await d.uow.tenant(who, async (r) => {
          const c = await r.lots.resolve(productId, b.component_id ?? null, b.supplier ?? null);
          if (!c) throw new LotFail("not_found");
          if (c.mode !== "stock" && c.mode !== "quota")
            throw new LotFail("invalid", "thành phần này không giữ kho — không nhập lô");
          const res = await r.lots.receive(
            {
              componentId: c.component_id,
              direction: "in",
              qty: b.qty,
              unitPrice: b.unit_price,
              reason: "manual",
              supplierPartyKey: c.party_key,
              expiresOn: b.expires_on ?? null,
            },
            on,
          );
          const x = res.components[0];
          if (!x) throw new LotFail("not_found");
          return {
            component_id: x.componentId,
            on_hand_before: x.onHandBefore,
            on_hand_after: x.onHandAfter,
            avg_cost_before: x.avgCostBefore,
            avg_cost_after: x.avgCostAfter,
          };
        });
      } catch (e) {
        if (e instanceof StockError) throw new LotFail("invalid", e.detail);
        throw e;
      }
    },
  };
}
export type LotsUsecase = ReturnType<typeof lotsUsecase>;
