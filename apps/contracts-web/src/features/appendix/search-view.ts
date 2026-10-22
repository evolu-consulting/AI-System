// Luật thuần ô tìm HĐ gốc của hộp "Gắn làm phụ lục": hiện gợi ý gõ / đang tìm / không thấy / danh sách.
export const MIN_SEARCH = 2;

export type SearchView = "hint" | "loading" | "empty" | "list";

export function searchView(p: {
  text: string;
  searching: boolean;
  suggesting: boolean;
  options: number;
}): SearchView {
  if (p.options > 0) return "list";
  const typed = p.text.trim().length >= MIN_SEARCH;
  if (p.searching || p.suggesting) return "loading";
  return typed ? "empty" : "hint";
}
