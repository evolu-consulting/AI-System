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
  /** Mẫu LIKE trên `search_key` (đã fold, thoát `% _ \`, bọc `%`). */
  like: string | null;
  /** `<sort>:<dir>` — một tham số chọn nhánh CASE. */
  order: `${ContractSortKey}:${ContractSortDir}`;
  limit: number;
  offset: number;
};

/** HĐ gốc của hàng phụ lục trong trang (HD5): mỗi HĐ gốc một lần. */
export type ListParentRef = { id: string; title: string; number: string | null };
export type ContractListPage<Row> = { total: number; items: Row[]; parents: ListParentRef[] };

/** Tệp gốc của HĐ ở FileBox (hàng `contracts.files` chưa xoá mềm) — chỉ dùng nội bộ để xin link, KHÔNG trả ra API. */
export type ContractFileRef = { org: string; fileId: string };

/** Đọc danh sách/facets/chi tiết: mỗi hàm = MỘT câu SQL (route = 2 câu gồm `set_config`). id lạ/tenant khác ⇒ `null`. */
export type ContractsReadRepo<Row, Facets, Detail = unknown> = {
  list(f: ContractListFilter): Promise<ContractListPage<Row>>;
  facets(): Promise<Facets>;
  detail(id: string): Promise<Detail | null>;
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
