// PK-FR-09 · PK-FR-08 · PK-AC10 · N1 plan §8, §10: tạo item + dòng + 1 hàng outbox chỉ mục trong CÙNG một tx của gói
// (tenant/user từ token qua `who`) — rollback thì không còn gì. Thứ tự câu: ghi cha+con, rồi outbox (3 câu kể cả set_config).
import type { PackUow, PackWho } from "../../kit/application/ports";
import { buildItem, type Item, type NewItem } from "../domain/item";
import type { IdGen, PkdemoRepos } from "./ports";

/** Tên thực thể trong `index_outbox` của gói. */
export const ITEM_ENTITY = "item";

export type CreateItem = (who: PackWho, input: NewItem) => Promise<Item>;

export function createItem(d: { uow: PackUow<PkdemoRepos>; newId: IdGen }): CreateItem {
  return async (who, input) => {
    const item = buildItem(input, d.newId);
    await d.uow.tenant(who, async (r) => {
      await r.items.insert(item);
      await r.outbox.enqueue([{ entity: ITEM_ENTITY, entity_id: item.id, op: "upsert" }]);
    });
    return item;
  };
}
