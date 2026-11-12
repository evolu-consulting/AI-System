// Chọn nhóm hàng (CR-129 L4): tóm tắt các nhóm đã chọn («A, B +2») và lọc theo ô tìm. Logic thuần, không đụng UI.
/** Tên nhóm hiển thị tối đa `max`, phần còn lại gộp thành «+N». Chưa chọn ⇒ chuỗi rỗng (nơi gọi tự hiện nhãn gợi ý). */
export function catsSummary(selected: string[], max = 2): string {
  if (selected.length === 0) return "";
  const shown = selected.slice(0, max).join(", ");
  return selected.length > max ? `${shown} +${selected.length - max}` : shown;
}

const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replaceAll(String.fromCharCode(0x111), "d");

/** Lọc không phân biệt hoa/thường và dấu tiếng Việt; ô tìm trống ⇒ giữ nguyên thứ tự gốc. */
export function filterCats(cats: string[], query: string): string[] {
  const q = fold(query.trim());
  return q ? cats.filter((c) => fold(c).includes(q)) : cats;
}

/** Bật/tắt một nhóm trong danh sách đã chọn. */
export const toggleCat = (list: string[], c: string): string[] =>
  list.includes(c) ? list.filter((x) => x !== c) : [...list, c];
