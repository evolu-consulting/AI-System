// HD-FR-07 · D-03 · D-10 · HD1 plan §4 §6: cổng đọc của gói hợp đồng (lớp 2 — chỉ kiểu). Repo dựng trong tx `PackUow`
// (role `contracts_rw` + `app.tenant_id`, RLS FORCE). Kiểu DTO (`@ai/contracts`) chỉ ở adapter ⇒ cổng generic theo dòng/facets.
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { AppendixRepo } from "./appendix.usecase";
import type { CategoriesRepo } from "./categories.usecase";
import type { ContractFieldsRepo } from "./patch-fields.usecase";

export const CONTRACT_SORT_KEYS = ["updated_at", "value", "end_date", "title"] as const;
export type ContractSortKey = (typeof CONTRACT_SORT_KEYS)[number];
export type ContractSortDir = "asc" | "desc";

/** Đầu vào danh sách đã qua zod ở biên (NFC, trim, giới hạn). Mảng = tham số lặp. */
export type ContractListInput = {
  q?: string | undefined;
  status?: readonly string[] | undefined;
  owner?: readonly string[] | undefined;
  category?: readonly string[] | undefined;
  seller?: readonly string[] | undefined;
  buyer?: readonly string[] | undefined;
  signer?: readonly string[] | undefined;
  direction?: readonly string[] | undefined;
  kind?: readonly string[] | undefined;
  value_min?: number | undefined;
  value_max?: number | undefined;
  /** Gap #10: lọc ngày (cột + cửa sổ tương đối + khoảng). */
  date_field?: "end_date" | "action_deadline" | undefined;
  due?: "overdue" | "30" | "60" | "90" | undefined;
  date_from?: string | undefined;
  date_to?: string | undefined;
  /** V2-A: `progress` ⇒ trả thêm giai đoạn + bước hiện tại. */
  include?: "progress" | undefined;
  sort: ContractSortKey;
  dir: ContractSortDir;
  page: number;
  page_size: number;
};

/** Bộ lọc gửi xuống SQL văn bản cố định: `null` = không lọc (mọi tham số luôn gửi). */
export type ContractListFilter = {
  status: readonly string[] | null;
  owner: readonly string[] | null;
  category: readonly string[] | null;
  seller: readonly string[] | null;
  buyer: readonly string[] | null;
  /** Khoá người (`personKey`) — so với cột sinh `signer_keys` bằng `&&`. */
  signerKeys: readonly string[] | null;
  direction: readonly string[] | null;
  kind: readonly string[] | null;
  valueMin: number | null;
  valueMax: number | null;
  /** Gap #10: cột ngày (`end_date` | `action_deadline`) + khoảng gồm hai đầu (`due` đã quy ra ngày ở use case); cả hai null = không lọc. */
  dateField: "end_date" | "action_deadline";
  dateFrom: string | null;
  dateTo: string | null;
  /** Mẫu LIKE trên `search_key` (đã fold, thoát `% _ \`, bọc `%`). */
  like: string | null;
  /** `<sort>:<dir>` — một tham số chọn nhánh CASE. */
  order: `${ContractSortKey}:${ContractSortDir}`;
  limit: number;
  offset: number;
};

/** HĐ gốc của hàng phụ lục trong trang (HD5): mỗi HĐ gốc một lần. */
export type ListParentRef = { id: string; title: string; number: string | null };
/** V2-A: `progress` = loại HĐ + giai đoạn + bước hiện tại từng HĐ của trang (DTO của adapter, cùng thứ tự `items`). */
export type ContractListPage<Row> = {
  total: number;
  items: Row[];
  parents: ListParentRef[];
  progress?: unknown[];
};

/** Gap #8: một hàng xuất tệp (cột hẹp, giá trị thô — định dạng ở domain `export.rules`); loại hàng đã quy ra tên. */
export type ContractExportRow = {
  number: string | null;
  title: string;
  kind: string;
  type: string | null;
  direction: string | null;
  status: string;
  seller: string | null;
  buyer: string | null;
  sellerSigner: string | null;
  buyerSigner: string | null;
  value: number | null;
  endDate: string | null;
  actionDeadline: string | null;
  ownerUserId: string | null;
  categories: string[];
  updatedAt: Date;
};

/** Tệp gốc của HĐ ở FileBox (hàng `contracts.files` chưa xoá mềm) — chỉ dùng nội bộ để xin link, KHÔNG trả ra API. */
export type ContractFileRef = { org: string; fileId: string };

/** Đọc danh sách/facets/chi tiết: mỗi hàm = MỘT câu SQL (route = 2 câu gồm `set_config`). id lạ/tenant khác ⇒ `null`. */
export type ContractsReadRepo<Row, Facets, Detail = unknown> = {
  /** V2-A: `today` (ngày lịch tenant) có ⇒ kèm `progress` (giai đoạn + quá hạn); vắng ⇒ không tính. */
  list(f: ContractListFilter, today?: string): Promise<ContractListPage<Row>>;
  facets(): Promise<Facets>;
  /** Gap #8: mọi hàng khớp bộ lọc (bỏ phân trang), tối đa `cap + 1` (dòng thừa = báo cắt), `total` = số khớp. MỘT câu + một câu loại hàng. */
  exportRows(
    f: ContractListFilter,
    cap: number,
  ): Promise<{ total: number; rows: ContractExportRow[] }>;
  detail(id: string, today?: string): Promise<Detail | null>;
  /** `source_text` (Markdown); HĐ không có hoặc source rỗng (`null`) ⇒ `null`. */
  source(id: string): Promise<string | null>;
  fileOf(id: string): Promise<ContractFileRef | null>;
};

/** Repo riêng của gói (adapter dựng); `createPackUow` ghép thêm `outbox`. */
export type ContractsOwnRepos<Row, Facets, Detail = unknown> = {
  contracts: ContractsReadRepo<Row, Facets, Detail>;
  /** T9: ghi trường (khoá hàng + CTE update/event). */
  fields: ContractFieldsRepo;
  /** HD5: phụ lục gắn HĐ gốc + bảng giá. */
  appendix: AppendixRepo;
  /** HD5: loại hàng của tenant. */
  categories: CategoriesRepo;
};
export type ContractsRepos<Row, Facets, Detail = unknown> = KitTxRepos &
  ContractsOwnRepos<Row, Facets, Detail>;
