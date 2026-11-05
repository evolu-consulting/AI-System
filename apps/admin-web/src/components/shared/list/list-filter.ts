// CR-121 C-1b · lõi lọc của trang danh sách: mỗi nhóm lọc là MỘT control (chọn một giá trị), chip suy ra từ giá trị đang chọn.
export type FilterOption = { value: string; label: string; count?: number };
export type FilterGroup = {
  id: string;
  label: string;
  options: FilterOption[];
  /** Giá trị đang chọn; `undefined` = không lọc theo nhóm này. */
  value?: string;
};
export type FilterChip = { groupId: string; groupLabel: string; value: string; label: string };

/** Bấm lại giá trị đang chọn thì bỏ chọn (một control, không có công tắc Bật/Tắt trùng). */
export function toggleValue(current: string | undefined, picked: string): string | undefined {
  return current === picked ? undefined : picked;
}

/** Chip cho các nhóm đang có giá trị khớp một lựa chọn; giá trị lạ (URL cũ) bị bỏ qua. */
export function buildChips(groups: readonly FilterGroup[]): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const g of groups) {
    if (g.value === undefined) continue;
    const opt = g.options.find((o) => o.value === g.value);
    if (opt) chips.push({ groupId: g.id, groupLabel: g.label, value: opt.value, label: opt.label });
  }
  return chips;
}

export const isFiltered = (groups: readonly FilterGroup[], q?: string): boolean =>
  buildChips(groups).length > 0 || !!q?.trim();

/** Lọc phía client theo `pick(item, groupId)`; nhóm không chọn thì bỏ qua. */
export function applyFilters<T>(
  items: readonly T[],
  groups: readonly FilterGroup[],
  pick: (item: T, groupId: string) => string | undefined,
): T[] {
  const active = groups.filter((g) => g.value !== undefined);
  if (active.length === 0) return [...items];
  return items.filter((it) => active.every((g) => pick(it, g.id) === g.value));
}
