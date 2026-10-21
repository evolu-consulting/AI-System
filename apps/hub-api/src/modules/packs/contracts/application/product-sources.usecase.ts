// gap-d1 #19 · "Cách lấy hàng" của SP: danh sách + thêm + xoá + bảng rủi ro phụ thuộc NCC (`dependencyRisk`). Mỗi lệnh một tx RLS của
// người gọi. SP Giới thiệu không có cách lấy hàng ⇒ not_found.
import type { PackUow, PackWho } from "../../kit/application/ports";
import { dependencyRisk, type PurchaseShare } from "../domain/product-sources.rules";
import type {
  ProductSourceCreate,
  ProductSourceOut,
  ProductSourcesOut,
} from "../domain/product-sources.types";

export type SourcesRepo = {
  /** null ⇒ SP không có / không thuộc tenant. */
  list(productId: string): Promise<{
    group: "service" | "goods" | "referral";
    items: ProductSourceOut[];
    purchases: PurchaseShare[];
  } | null>;
  /** null ⇒ SP không có / Giới thiệu. Trùng NCC ⇒ ném lỗi 23505 của Postgres. */
  add(productId: string, b: ProductSourceCreate): Promise<ProductSourceOut | null>;
  remove(productId: string, sourceId: string): Promise<boolean>;
};

export class SourceFail extends Error {
  constructor(readonly kind: "not_found" | "exists") {
    super(kind);
  }
}

const pgCode = (e: unknown): string | undefined =>
  (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;

export function sourcesUsecase(d: { uow: PackUow<{ sources: SourcesRepo }> }) {
  const tx = <T>(who: PackWho, fn: (r: SourcesRepo) => Promise<T>) =>
    d.uow.tenant(who, (r) => fn(r.sources));
  return {
    async list(who: PackWho, productId: string): Promise<ProductSourcesOut> {
      const r = await tx(who, (x) => x.list(productId));
      if (!r || r.group === "referral") throw new SourceFail("not_found");
      return { items: r.items, ...dependencyRisk(r.items, r.purchases) };
    },
    async add(who: PackWho, productId: string, b: ProductSourceCreate): Promise<ProductSourceOut> {
      try {
        const r = await tx(who, (x) => x.add(productId, b));
        if (!r) throw new SourceFail("not_found");
        return r;
      } catch (e) {
        if (pgCode(e) === "23505") throw new SourceFail("exists");
        throw e;
      }
    },
    async remove(who: PackWho, productId: string, sourceId: string): Promise<void> {
      if (!(await tx(who, (x) => x.remove(productId, sourceId)))) throw new SourceFail("not_found");
    },
  };
}
export type SourcesUsecase = ReturnType<typeof sourcesUsecase>;
