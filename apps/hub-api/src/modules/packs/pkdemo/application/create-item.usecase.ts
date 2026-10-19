// PK-FR-09 · PK-AC10 · N1 plan §10: tạo item + dòng trong một tx của gói (tenant/user từ token qua `who`).
import type { PackUow, PackWho } from "../../kit/application/ports";
import { buildItem, type Item, type NewItem } from "../domain/item";
import type { IdGen, PkdemoRepos } from "./ports";

export type CreateItem = (who: PackWho, input: NewItem) => Promise<Item>;

export function createItem(d: { uow: PackUow<PkdemoRepos>; newId: IdGen }): CreateItem {
  return async (who, input) => {
    const item = buildItem(input, d.newId);
    await d.uow.tenant(who, (r) => r.items.insert(item));
    return item;
  };
}
