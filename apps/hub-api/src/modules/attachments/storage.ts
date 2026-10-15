// HUB-FR-44 · H2c-R04, R05, R29 · PL1 · interface lưu nội dung file (driver `local`: `storage.local.ts`) + khoá
// `<tenant_id>/<id>` (plan-rules §4). Hàm thuần ở đây; I/O (`realpath` + so gốc) ở driver.

/** Kiểm từng chunk khi ghi (`sniff.rules.ts` `FileInspector`); `false` = từ chối. */
export type ChunkInspector = { push(chunk: Uint8Array): boolean; end(): boolean };

/** Đã ghi `<key>.part` (đếm + sha256 + kiểm); `commit` = rename sau khi DB commit (R05); `discard` = xoá `.part`.
 * FB1 (HUB-FR-138): driver `filebox` điền `fileId`/`versionId` (đã `POST /files`); `local` để `null`/vắng. */
export type Staged = {
  size: number;
  sha256: string;
  /** FileBox `file_id` (null với kho local). */
  fileId?: string | null;
  /** FileBox `version_id` (null với kho local). */
  versionId?: string | null;
  commit(): Promise<void>;
  discard(): Promise<void>;
};

/** Kết quả `remove` (FB1 HUB-FR-142): `missing` = kho báo không còn (FileBox 404) ⇒ sweeper log `already_gone`. */
export type RemoveResult = "deleted" | "missing";

/** Mục trên kho (quét mồ côi): `partial` = `.part`. */
export type StoredEntry = { key: string; partial: boolean; size: number; mtimeMs: number };

/** Con trỏ `list`: mục cuối lô trước theo cặp (key, partial) — không bỏ sót `<key>.part` sau `<key>` (RV-9). */
export type StoreCursor = Pick<StoredEntry, "key" | "partial">;

export interface AttachmentStorage {
  readonly driver: "local" | "filebox";
  stage(
    key: string,
    body: ReadableStream<Uint8Array>,
    o: { maxBytes: number; inspect?: ChunkInspector },
  ): Promise<Staged>;
  /** null = không có file. */
  open(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null>;
  blob(key: string, type: string): Promise<Blob | null>;
  /** Xoá cả `<key>` và `<key>.part`; không có = `missing`. */
  remove(key: string): Promise<RemoveResult>;
  /**
   * Hoàn tất `commit` dở (PL13, sweeper): `<key>.part` → `<key>`; `<key>` đã có ⇒ chỉ xoá `.part`; không có `.part` = ok.
   */
  promote(key: string): Promise<void>;
  /** Sắp theo (key, partial); `after` chuỗi = sau mọi mục của khoá đó, cặp = sau đúng mục đó. */
  list(o: { after: string | StoreCursor | null; limit: number }): Promise<StoredEntry[]>;
  /** FB1 (HUB-FR-139): URL tải trực tiếp cho locator `fb/<file_id>` (FileBox `/link`, tuyệt đối); null = 404. Chỉ driver filebox. */
  link?(fileId: string): Promise<string | null>;
}

/** Vượt `maxBytes` khi ghi (413). */
export class StorageTooLarge extends Error {}
/** `inspect` từ chối nội dung (415). */
export class StorageRejected extends Error {}
/** Khoá sai / thư mục tenant ngoài gốc. */
export class StorageKeyError extends Error {}

/** Phụ thuộc file của app (`AppDeps.attachments`, plan §4): vắng ⇒ không mount route file/nội bộ file/sweeper (PL14). */
export type AttachmentDeps = {
  storage: AttachmentStorage;
  tenantMaxBytes: number;
  sweepS: number;
  /** `false` ⇒ không chạy vòng sweeper nền (test, L1). Vắng = chạy. */
  sweep?: boolean;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);
const KEY_RE = new RegExp(`^${UUID}/${UUID}$`);

/** uuid chữ thường (tên thư mục tenant / tên file trên kho). */
export function isUuidName(s: string): boolean {
  return UUID_RE.test(s);
}

/** `tenantId + "/" + id`. */
export function storageKey(tenantId: string, id: string): string {
  return `${tenantId}/${id}`;
}

/** `<uuid>/<uuid>` chữ thường. */
export function isStorageKey(k: string): boolean {
  return KEY_RE.test(k);
}

/** Khoá hợp lệ → `root + sep + tenant + sep + id`; khác → null (`realpath` + so gốc ở driver). */
export function keyUnder(root: string, key: string, sep: "/" | "\\"): string | null {
  if (!isStorageKey(key)) return null;
  const [tenant, id] = key.split("/") as [string, string];
  return `${root}${sep}${tenant}${sep}${id}`;
}

// --- FB1 (HUB-FR-138) · locator FileBox + luật thuần (spec §3.1, §4.7) ---

/** Hàng bất kỳ có tham chiếu FileBox (locator/cột). */
export type FileboxRow = { filebox_file_id: string | null };
/** Hàng đủ để dựng locator đọc/xoá (local = `storage_key`; filebox = `fb/<file_id>[/<version_id>]`). */
export type LocatorRow = {
  storage_key: string;
  filebox_file_id: string | null;
  filebox_version_id: string | null;
};

/** `fb/<fileId>` hoặc `fb/<fileId>/<versionId>` (versionId null ⇒ bỏ). */
export function fileboxLocator(fileId: string, versionId: string | null): string {
  return versionId === null ? `fb/${fileId}` : `fb/${fileId}/${versionId}`;
}

/** Ngược của `fileboxLocator`; khoá local `tenant/id` hoặc rác ⇒ null. */
export function parseFileboxLocator(
  key: string,
): { fileId: string; versionId: string | null } | null {
  if (!key.startsWith("fb/")) return null;
  const parts = key.slice(3).split("/");
  const fileId = parts[0];
  if (!fileId) return null;
  return { fileId, versionId: parts.length > 1 ? (parts[1] ?? null) : null };
}

/** Locator đọc/xoá của một hàng: có `filebox_file_id` ⇒ `fb/…`; không ⇒ `storage_key` (hàng local không đổi). */
export function storageLocatorOf(r: LocatorRow): string {
  return r.filebox_file_id === null
    ? r.storage_key
    : fileboxLocator(r.filebox_file_id, r.filebox_version_id);
}

/** Hàng thuộc kho FileBox ⇔ `filebox_file_id != null`. */
export function isFileboxRow(r: FileboxRow): boolean {
  return r.filebox_file_id !== null;
}

/** Trạng thái idempotent nên thử lại (5xx hoặc lỗi mạng `null`); 2xx/4xx ⇒ không. */
export function fileboxRetryable(status: number | null): boolean {
  return status === null || (status >= 500 && status <= 599);
}

/** FileBox không dùng được sau retry / vắng token ⇒ người gọi map `INTERNAL_ERROR` (fail-closed). */
export class FileboxUnavailable extends Error {
  constructor(message = "filebox unavailable") {
    super(message);
    this.name = "FileboxUnavailable";
  }
}
