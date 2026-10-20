// V2-B · danh mục SP: liệt kê / chi tiết / tạo (thành phần + quy tắc + NCC chính) / gợi ý SP cho dòng HĐ / thêm-xoá quy tắc. Mỗi
// lệnh một tx RLS của người gọi; gợi ý đọc cả danh mục (≤ PRODUCTS_MATCH_SCAN SP) rồi so khớp thuần (`matchLine`).
import type {
  ProductCreate,
  ProductDetailOut,
  ProductMatch,
  ProductMatchOut,
  ProductOut,
  ProductRuleCreate,
  ProductRuleOut,
  ProductsQuery,
} from "@ai/contracts";
import type { PackUow, PackWho } from "../../kit/application/ports";
import { matchLine, type ProductPlan, productPlan } from "../domain/products.rules";

export const PRODUCTS_LIMIT = 100;
export const PRODUCTS_MATCH_SCAN = 2000;

export type ProductsRepo = {
  list(q: ProductsQuery & { limit: number }): Promise<ProductOut[]>;
  get(id: string): Promise<ProductDetailOut | null>;
  /** null ⇒ HĐ nguồn không có / không thấy. Trùng tên ⇒ ném lỗi 23505 của Postgres. */
  create(p: ProductCreate, plan: ProductPlan): Promise<ProductOut | null>;
  addRule(
    productId: string,
    pattern: string,
    componentId: string | null,
  ): Promise<ProductRuleOut | null>;
  deleteRule(productId: string, ruleId: string): Promise<boolean>;
};
export type ProductsRepos = { products: ProductsRepo };

export class ProductFail extends Error {
  constructor(
    readonly kind: "not_found" | "invalid" | "exists",
    detail: string = kind,
  ) {
    super(detail);
  }
}

const pgCode = (e: unknown): string | undefined =>
  (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;

export function productsUsecases(d: { uow: PackUow<ProductsRepos> }) {
  const tx = <T>(who: PackWho, fn: (r: ProductsRepo) => Promise<T>) =>
    d.uow.tenant(who, (r) => fn(r.products));
  return {
    list: (who: PackWho, q: ProductsQuery) =>
      tx(who, (r) => r.list({ ...q, limit: q.limit ?? PRODUCTS_LIMIT })),
    async get(who: PackWho, id: string): Promise<ProductDetailOut> {
      const p = await tx(who, (r) => r.get(id));
      if (!p) throw new ProductFail("not_found");
      return p;
    },
    async create(who: PackWho, body: ProductCreate): Promise<ProductOut> {
      const plan = productPlan(body);
      if (typeof plan === "string") throw new ProductFail("invalid", plan);
      try {
        const p = await tx(who, (r) => r.create(body, plan));
        if (!p) throw new ProductFail("not_found");
        return p;
      } catch (e) {
        if (pgCode(e) === "23505") throw new ProductFail("exists");
        throw e;
      }
    },
    async match(who: PackWho, body: ProductMatch): Promise<ProductMatchOut> {
      const all = await tx(who, (r) => r.list({ limit: PRODUCTS_MATCH_SCAN }));
      return matchLine(body.text, body.deal, all);
    },
    async addRule(
      who: PackWho,
      productId: string,
      body: ProductRuleCreate,
    ): Promise<ProductRuleOut> {
      try {
        const r = await tx(who, (x) =>
          x.addRule(productId, body.pattern, body.component_id ?? null),
        );
        if (!r) throw new ProductFail("not_found");
        return r;
      } catch (e) {
        if (pgCode(e) === "23505") throw new ProductFail("exists");
        throw e;
      }
    },
    async deleteRule(who: PackWho, productId: string, ruleId: string): Promise<void> {
      if (!(await tx(who, (r) => r.deleteRule(productId, ruleId))))
        throw new ProductFail("not_found");
    },
  };
}
export type ProductsUsecases = ReturnType<typeof productsUsecases>;
