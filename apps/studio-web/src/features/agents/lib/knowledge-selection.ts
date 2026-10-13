// HUB-FR-132 · logic thuần của việc chọn kết nối KnowledgeHub (tách khỏi hook để test không cần render).
export const KH_MAX = 5;

/** Tick/bỏ tick có thứ tự; tối đa KH_MAX, không trùng. */
export function applyToggle(cur: string[], id: string, on: boolean): string[] {
  if (!on) return cur.filter((x) => x !== id);
  return cur.includes(id) || cur.length >= KH_MAX ? cur : [...cur, id];
}

/** Agent không phải CLI: bỏ tick bất kỳ ô nào = gỡ hết. */
export function applyChange(cur: string[], id: string, on: boolean, cli: boolean): string[] {
  return cli ? applyToggle(cur, id, on) : [];
}

export const isDirty = (ids: string[], saved: string[]) =>
  JSON.stringify(ids) !== JSON.stringify(saved);

/** Ô chưa tick bị khoá khi agent không phải CLI hoặc đã đủ KH_MAX. */
export const rowDisabled = (selected: boolean, cli: boolean, count: number) =>
  !selected && (!cli || count >= KH_MAX);

/** Chú thích "bỏ chọn sẽ gỡ toàn bộ" chỉ hiện cho agent không phải CLI còn kết nối. */
export const showUntickNote = (cli: boolean, count: number) => !cli && count > 0;
