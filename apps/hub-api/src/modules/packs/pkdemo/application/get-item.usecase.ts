// PK-FR-09 · PK-AC10 · N1 plan §10: đọc item + dòng theo id trong tx RLS của tenant token; tenant khác ⇒ null.
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { Item } from "../domain/item";
import type { PkdemoRepos } from "./ports";

export type GetItem = (who: PackWho, id: string) => Promise<Item | null>;

export function getItem(d: { uow: PackUow<PkdemoRepos> }): GetItem {
  return (who, id) => d.uow.tenant(who, (r) => r.items.get(id));
}
