// HUB-FR-69 · một dòng của bảng "Xem khác biệt".
export type DiffRow = {
  path: string;
  mine: string;
  latest: string;
  mineEmpty: boolean;
  latestEmpty: boolean;
};
export type DiffResult = { rows: DiffRow[]; more: number };
