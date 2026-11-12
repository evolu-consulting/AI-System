// CR-137 · danh sách quản trị (Yêu cầu tham gia, Báo cáo vi phạm) dạng bảng: lọc trạng thái, sắp xếp, ngày ngắn. Logic thuần.

export type StatusFilter<S extends string> = S | "all";

/** Lọc theo trạng thái; "all" ⇒ giữ hết. */
export function filterByStatus<T extends { status: string }, S extends string>(
  items: T[],
  filter: StatusFilter<S>,
): T[] {
  return filter === "all" ? items : items.filter((i) => i.status === filter);
}

/** Chờ xử lý lên đầu, rồi mới nhất trước (theo `createdAt` ISO). Không đổi mảng gốc. */
export function sortForReview<T extends { status: string; createdAt: string }>(
  items: T[],
  pendingStatus: string,
): T[] {
  return [...items].sort((a, b) => {
    const pa = a.status === pendingStatus ? 0 : 1;
    const pb = b.status === pendingStatus ? 0 : 1;
    return pa - pb || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
  });
}

/** Số dòng theo từng trạng thái (cho nhãn bộ lọc). */
export function countByStatus<T extends { status: string }>(items: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i.status] = (out[i.status] ?? 0) + 1;
  return out;
}

/** ISO ⇒ ngày ngắn theo locale UI; hỏng ⇒ chuỗi rỗng. */
export function shortDay(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale);
}

/** Dòng đang chọn còn trong danh sách đã lọc? Không ⇒ null (đóng khung chi tiết). */
export function keepSelection<T extends { id: string }>(
  items: T[],
  id: string | null,
): string | null {
  return id !== null && items.some((i) => i.id === id) ? id : null;
}
