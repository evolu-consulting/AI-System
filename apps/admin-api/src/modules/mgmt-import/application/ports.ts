// I1 · cổng của importer mgmt-app: nguồn chỉ-đọc (OpenSearch + Neo4j), đích Postgres theo lô (một câu mỗi bảng mỗi lô),
// file. Lớp 2 — chỉ kiểu.
import type { GraphKey, SourceDoc } from "../domain/context";
import type { MoneyKey, Row, TableName } from "../domain/plan";

export type { GraphKey as GraphQuery, SourceDoc };

export type SourceReader = {
  /** Đọc cả index theo lô (thứ tự `_doc`); index chưa có ⇒ không lô nào. */
  scan(index: string, batch: number): AsyncIterable<SourceDoc[]>;
  count(index: string): Promise<number>;
  /** Hàng đồ thị theo truy vấn đọc có tên; mỗi hàng = giá trị cột RETURN. */
  graph(q: GraphKey, batch: number): AsyncIterable<unknown[][]>;
};

/** File duy nhất trong thư mục tương đối `<org>/<hđ>` dưới `contract_files` của mgmt-app; không có ⇒ null. */
export type FileSource = {
  readDir(rel: string): Promise<{ name: string; bytes: Uint8Array } | null>;
};

/** Điểm dừng để chạy tiếp: khoá lô đã ghi xong (`tenant|bảng|i`). */
export type Checkpoint = { done(key: string): boolean; mark(key: string): Promise<void> };

/** Tập HĐ (id đích) một user thấy qua RLS thật của gói. */
export type VisibilityProbe = (tenantId: string, userId: string) => Promise<Set<string>>;

/** Nơi nhận bytes file: FileBox (cutover thật) hoặc thư mục cục bộ (bản sao seed). */
export type FileSink = {
  put(
    org: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<{ fileId: string; versionId: string | null }>;
  /** Đọc lại bytes đã nhận (đối soát checksum); không hỗ trợ ⇒ null. */
  readBack(fileId: string): Promise<Uint8Array | null>;
};

export type TargetStore = {
  /** Ghi MỘT lô của một bảng trong một tenant (một tx RLS gói, một câu); trả số hàng thực sự chèn. */
  write(tenantId: string, table: TableName, rows: Row[]): Promise<number>;
  /** Số hàng của lô đã có ở đích (khoá id hoặc khoá tự nhiên) — dry-run và báo cáo "đã có". */
  existing(tenantId: string, table: TableName, rows: Row[]): Promise<number>;
  /** Tổng tiền đích theo tenant, chỉ trên hàng do lần nhập này sở hữu (id thuộc tập kế hoạch). */
  money(
    tenantId: string,
    ids: Partial<Record<TableName, string[]>>,
  ): Promise<Partial<Record<MoneyKey, bigint>>>;
  /** Đọc lại hàng đích theo id (mẫu so từng trường). */
  readBack(tenantId: string, table: TableName, ids: string[]): Promise<Row[]>;
  /** Bảng có ở DB đích không (G1 chưa merge ⇒ bỏ qua có báo). */
  hasTable(table: TableName): Promise<boolean>;
};

/** Nhập user/org bằng N5 (`runIdentityImport`) và tra cứu tenant/user đã nhập. */
export type IdentityPort = {
  run(exportFile: unknown, apply: boolean): Promise<unknown>;
  /** Mọi tenant có marker nguồn, kèm cờ dùng được (đang hoạt động, gói `contracts` chưa bị thu hồi). */
  tenants(
    source: string,
  ): Promise<{ id: string; orgId: string; active: boolean; packRevoked: boolean }[]>;
  users(tenantIds: string[]): Promise<{ id: string; tenantId: string; email: string }[]>;
  /** niti-onboard: tenant theo key + marker (để `--into-tenant` tra org đã gắn). */
  tenantByKey(
    key: string,
  ): Promise<{ id: string; active: boolean; source: string | null; orgId: string | null } | null>;
};

/** Tuỳ chọn + phụ thuộc của use case (ở đây — không ở import.usecase — để reconcile không import ngược: hết vòng, review C). */
export type ImportOpts = {
  source: string;
  apply: boolean;
  batch: number;
  /** Org nhận tài liệu tri thức chung (domain=general); null ⇒ không chuyển (đếm ở no_tenant). */
  knowledgeOrg: string | null;
  /** Actor (platform admin) — dự phòng `created_by` khi org không có chủ. */
  actorId: string;
  withGraph: boolean;
  diffSample: number;
  /**
   * niti-onboard (`--into-tenant`): chỉ nhập MỘT org (org gắn với tenant đích qua marker onboarding); org khác ⇒ không đụng
   * (không tạo tenant, user/HĐ của họ đếm ở `excluded_orgs`/`no_tenant`). Vắng ⇒ mọi org (I1 gốc).
   */
  onlyOrg?: string | null;
};
export type ImportDeps = {
  reader: SourceReader;
  identity: IdentityPort;
  target: TargetStore;
  files: { source: FileSource | null; sink: FileSink | null };
  checkpoint: Checkpoint;
  visible: VisibilityProbe;
  now: () => number;
};
