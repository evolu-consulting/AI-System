// PK-FR-09 · N1 plan §9: cổng của gói `pkdemo` (lớp 2). Repo trong tx của `PackUow` (RLS `pkdemo_rw` + tenant).
import type { Item } from "../domain/item";

export type ItemsRepo = {
  /** Cha + mọi con trong MỘT câu (lô con qua một tham số JSON). */
  insert(item: Item): Promise<void>;
  /** Cha + con (json_agg) trong MỘT câu; không thấy (kể cả tenant khác) ⇒ null. */
  get(id: string): Promise<Item | null>;
};

export type PkdemoRepos = { items: ItemsRepo };

/** Sinh id tăng dần (thứ tự dòng). */
export type IdGen = () => string;
