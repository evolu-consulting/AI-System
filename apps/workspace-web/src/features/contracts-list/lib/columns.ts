// Khoá cột bảng danh sách (tách khỏi component để ChildRows/ContractCells không vòng nhau).
export const COLUMN_KEYS = [
  "title",
  "number",
  "partner",
  "type",
  "value",
  "dates",
  "status",
  "waiting",
] as const;
/** DOC-ui-gaps: cột "Nguồn" chỉ hiện khi lọc Giao dịch (HĐ không có nguồn); chèn sau "Loại". */
export const COLUMN_KEYS_DEAL = [
  "title",
  "number",
  "partner",
  "type",
  "source",
  "value",
  "dates",
  "status",
  "waiting",
] as const;
export type ColumnKey = (typeof COLUMN_KEYS_DEAL)[number];
