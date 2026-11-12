// CR-132 · W2 · luật thuần chọn người: lọc theo tên (không dấu), bỏ chính mình / người đã trong nhóm, và quyết định «nhắn riêng hay tạo nhóm».
import { MSG_GROUP_MAX } from "@ai/contracts/pack-contracts";
import { foldText } from "./format";

export type Person = { id: string; name: string };

/** Lọc theo tên; `excludeIds` (mình, người đã trong nhóm) không hiện. */
export function filterPeople(
  people: readonly Person[],
  q: string,
  excludeIds: readonly string[] = [],
): Person[] {
  const ex = new Set(excludeIds);
  const needle = foldText(q.trim());
  return people.filter((p) => !ex.has(p.id) && (!needle || foldText(p.name).includes(needle)));
}

export type PickMode = "none" | "direct" | "group" | "full";
/** 0 người ⇒ chưa chọn; 1 ⇒ nhắn riêng; ≥ 2 ⇒ nhóm (chủ + chọn ≤ 50); vượt ⇒ full. */
export function pickMode(n: number): PickMode {
  if (n <= 0) return "none";
  if (n === 1) return "direct";
  return n > MSG_GROUP_MAX - 1 ? "full" : "group";
}
