// CR-125 c3 · MỘT nơi TS ghép tên/mã HĐ từ một hàng đã có `title` (cột/nhãn) + `number` — cạnh bản SQL `adapters/contract-name.sql.ts`.
// - tên trước (`contractNameOf`): danh sách việc/hẹn nhắc (≙ `contractLabelSql`: tên ⇒ mã).
// - mã trước (`contractCodeOf`): thông báo/chuông (≙ `contractCodeSql`: mã ⇒ tên). Tên ở đây là `title` hàng được truyền vào.
// Chặn tự ghép lại ở nơi khác: `bun run check:contract-name` (chế độ TS).
type Row = { number?: string | null; title?: string | null } | null | undefined;

export const contractNameOf = (k: Row): string | null => k?.title ?? k?.number ?? null;
export const contractCodeOf = (k: Row): string | null => k?.number ?? k?.title ?? null;
/** Nhãn ngắn cho chuông/thông báo (≤ 120 ký tự, thiếu cả hai ⇒ chuỗi rỗng). */
export const contractCodeLabel = (k: Row): string => (contractCodeOf(k) ?? "").slice(0, 120);
