// Khoá cột bảng danh sách (tách khỏi component để ChildRows/ContractCells không vòng nhau).
export const COLUMN_KEYS = ["title", "partner", "type", "value", "dates", "stage"] as const;
/** DOC-ui-gaps: cột "Nguồn" chỉ hiện khi lọc Giao dịch (HĐ không có nguồn); chèn sau "Loại". */
export const COLUMN_KEYS_DEAL = [
  "title",
  "partner",
  "type",
  "source",
  "value",
  "dates",
  "stage",
] as const;
export type ColumnKey = (typeof COLUMN_KEYS_DEAL)[number];
