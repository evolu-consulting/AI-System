// ADM-FR-36 · Tìm user theo username đúng trong danh sách sort `username` tăng, nạp nhiều trang (logic dừng thuần).
export const LOOKUP_MAX_PAGES = 20;

type Step = { items: { username: string }[]; total: number; offset: number; pages: number };

/**
 * `found`/`stop`: dừng; `more`: nạp trang kế. Dừng khi: gặp đúng · hết `total` · trang rỗng · đủ trần. Không dừng sớm theo so
 * sánh chuỗi: thứ tự `order by username` theo collation của DB có thể khác JS (review M3 vòng 2 #1).
 */
export function lookupStep(s: Step, username: string): "found" | "stop" | "more" {
  if (s.items.some((u) => u.username === username)) return "found";
  const last = s.items[s.items.length - 1];
  if (!last) return "stop";
  if (s.offset + s.items.length >= s.total) return "stop";
  if (s.pages >= LOOKUP_MAX_PAGES) return "stop";
  return "more";
}
