// PK-FR-09 · D-08 · N1 plan §10 (body pkdemo): thực thể của gói kiểm thử `pkdemo` — khuôn lớp 1 cho gói thật (HD1+).
// Chỉ built-in. Giới hạn trùng CHECK của `migrations-pack-pkdemo/0001_init.sql`.

export const ITEM_TITLE_MAX = 200;
export const ITEM_LINE_TEXT_MAX = 200;
export const ITEM_LINES_MAX = 100;

export type ItemLine = { id: string; text: string };
/** Không có `tenant_id`: phạm vi tenant là việc của UoW (PK-AC10). */
export type Item = { id: string; title: string; lines: ItemLine[] };
export type NewItem = { title: string; lines: { text: string }[] };

/** Dựng item mới với id do cổng sinh (thứ tự dòng = thứ tự id — sinh tăng dần). */
export function buildItem(input: NewItem, newId: () => string): Item {
  return {
    id: newId(),
    title: input.title,
    lines: input.lines.map((l) => ({ id: newId(), text: l.text })),
  };
}
