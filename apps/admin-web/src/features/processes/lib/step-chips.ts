// CR-121 c15 · chip bước dùng chung (Thư viện quy trình + Công ty › Quy trình): chip là TÊN bước, tối đa 4 rồi "+N". Logic thuần.

import type { FlowWhen } from "@ai/contracts/pack-contracts";
import type { LibraryListItem } from "../library-api";
import { describeWhen } from "./library-list";

export const MAX_CHIPS = 4;
/** Tổng ký tự tối đa của các chip hiện ra trước khi gộp phần còn lại vào "+N" (chip KHÔNG bị cắt giữa chữ). */
export const CHIP_CHAR_BUDGET = 44;

export type Chip = { key: string; name: string; index: number };

/** Danh sách bước ⇒ chip hiển thị + phần còn lại (hiện "+N", tooltip liệt kê tên). Tối đa `max` chip và `budget` ký tự; luôn hiện ít nhất 1. */
export function splitChips<S extends { name: string }>(
  steps: readonly S[],
  max = MAX_CHIPS,
  budget = CHIP_CHAR_BUDGET,
): { shown: S[]; rest: S[] } {
  let used = 0;
  let n = 0;
  for (const s of steps) {
    if (n >= max || (n > 0 && used + s.name.length > budget)) break;
    used += s.name.length;
    n += 1;
  }
  return { shown: steps.slice(0, n), rest: steps.slice(n) };
}
/** Bước của dòng thư viện ⇒ chip (khoá theo vị trí vì tên có thể trùng); thiếu dữ liệu ⇒ []. */
export function libraryChips(row: Pick<LibraryListItem, "steps">): Chip[] {
  return (row.steps ?? []).map((s, i) => ({ key: `${i}:${s.name}`, name: s.name, index: i + 1 }));
}

/** Nhãn điều kiện của các bước ("Chỉ khi giá trị ≥ 500 tr…"), bỏ trùng; dòng không có bước điều kiện ⇒ []. */
export function libraryConditions(row: Pick<LibraryListItem, "steps">): string[] {
  const out = (row.steps ?? [])
    .map((s) => describeWhen(s.when as FlowWhen | null | undefined))
    .filter((x): x is string => x !== null);
  return [...new Set(out)];
}
