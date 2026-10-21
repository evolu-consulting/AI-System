// Gap #8: kết quả tải tệp xuất (thân + tên + tổng khớp + cờ cắt trần) — kiểu dùng chung của api và nút xuất.
export type ExportFile = { blob: Blob; filename: string; total: number; truncated: boolean };
