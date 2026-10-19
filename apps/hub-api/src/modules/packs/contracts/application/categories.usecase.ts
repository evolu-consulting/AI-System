// HD-FR-53 · HD5 plan: loại hàng của tenant — danh sách + thêm. Một tx `PackUow`, một câu SQL mỗi ca (ngoài `set_config`).
import type { PackUow, PackWho } from "../../kit/application/ports";

export type CategoryRow = { id: string; name: string };
/** Trần số loại hàng/tenant (= `CATEGORIES_MAX` của contract; facets cắt ở 200). */
export const CATEGORY_CAP = 200;

export type CategoriesRepo = {
  list(limit: number): Promise<CategoryRow[]>;
  /** Một câu: chèn nếu tên chưa có (không phân biệt hoa/thường) và chưa tới trần. */
  create(
    name: string,
    cap: number,
  ): Promise<{ kind: "created"; row: CategoryRow } | { kind: "exists" } | { kind: "full" }>;
};

type Uow = PackUow<{ categories: CategoriesRepo }>;

export type ListCategories = (who: PackWho) => Promise<CategoryRow[]>;
export const listCategories =
  (d: { uow: Uow }): ListCategories =>
  (who) =>
    d.uow.tenant(who, (r) => r.categories.list(CATEGORY_CAP));

export type CreateCategory = (
  who: PackWho,
  name: string,
) => Promise<Awaited<ReturnType<CategoriesRepo["create"]>>>;
export const createCategory =
  (d: { uow: Uow }): CreateCategory =>
  (who, name) =>
    d.uow.tenant(who, (r) => r.categories.create(name, CATEGORY_CAP));
