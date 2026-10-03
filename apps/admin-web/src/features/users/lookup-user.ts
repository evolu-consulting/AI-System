// ADM-FR-36 · Tìm user theo username đúng trong danh sách sort `username` tăng, nạp nhiều trang (logic dừng thuần).
export const LOOKUP_MAX_PAGES = 20;

type Step = { items: { username: string }[]; total: number; offset: number; pages: number };

/** `found`/`stop`: dừng; `more`: nạp trang kế. Dừng khi: gặp đúng · username cuối trang > cần tìm · hết `total` · trang rỗng · đủ trần. */
export function lookupStep(s: Step, username: string): "found" | "stop" | "more" {
  if (s.items.some((u) => u.username === username)) return "found";
  const last = s.items[s.items.length - 1];
  if (!last) return "stop";
  if (last.username.toLowerCase() > username.toLowerCase()) return "stop";
  if (s.offset + s.items.length >= s.total) return "stop";
  if (s.pages >= LOOKUP_MAX_PAGES) return "stop";
  return "more";
}
