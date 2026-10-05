// HUB-FR-44 · H2c-R04, R05, R29 · PL1 · interface lưu nội dung file (driver `local`: `storage.local.ts`) + khoá
// `<tenant_id>/<id>` (plan-rules §4). Hàm thuần ở đây; I/O (`realpath` + so gốc) ở driver.

/** Kiểm từng chunk khi ghi (`sniff.rules.ts` `FileInspector`); `false` = từ chối. */
export type ChunkInspector = { push(chunk: Uint8Array): boolean; end(): boolean };

/** Đã ghi `<key>.part` (đếm + sha256 + kiểm); `commit` = rename sau khi DB commit (R05); `discard` = xoá `.part`. */
export type Staged = {
  size: number;
  sha256: string;
  commit(): Promise<void>;
  discard(): Promise<void>;
};

/** Mục trên kho (quét mồ côi): `partial` = `.part`. */
export type StoredEntry = { key: string; partial: boolean; size: number; mtimeMs: number };

/** Con trỏ `list`: mục cuối lô trước theo cặp (key, partial) — không bỏ sót `<key>.part` sau `<key>` (RV-9). */
export type StoreCursor = Pick<StoredEntry, "key" | "partial">;

export interface AttachmentStorage {
  readonly driver: "local";
  stage(
    key: string,
    body: ReadableStream<Uint8Array>,
    o: { maxBytes: number; inspect?: ChunkInspector },
  ): Promise<Staged>;
  /** null = không có file. */
  open(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null>;
  blob(key: string, type: string): Promise<Blob | null>;
  /** Xoá cả `<key>` và `<key>.part`; không có = ok. */
  remove(key: string): Promise<void>;
  /**
   * Hoàn tất `commit` dở (PL13, sweeper): `<key>.part` → `<key>`; `<key>` đã có ⇒ chỉ xoá `.part`; không có `.part` = ok.
   */
  promote(key: string): Promise<void>;
  /** Sắp theo (key, partial); `after` chuỗi = sau mọi mục của khoá đó, cặp = sau đúng mục đó. */
  list(o: { after: string | StoreCursor | null; limit: number }): Promise<StoredEntry[]>;
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
