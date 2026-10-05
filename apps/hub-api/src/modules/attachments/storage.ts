// HUB-FR-44 · H2c-R04, R05, R29 · PL1 · interface lưu nội dung file (driver `local`: `storage.local.ts`) + khoá
// `<tenant_id>/<id>` (plan-rules §4). B0: interface + chữ ký (thân ném `not implemented`) — B1.

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
  /** Sắp theo key. */
  list(o: { after: string | null; limit: number }): Promise<StoredEntry[]>;
}

/** Vượt `maxBytes` khi ghi (413). */
export class StorageTooLarge extends Error {}
/** `inspect` từ chối nội dung (415). */
export class StorageRejected extends Error {}
/** Khoá sai / thư mục tenant ngoài gốc. */
export class StorageKeyError extends Error {}

/** `tenantId + "/" + id`. */
export function storageKey(_tenantId: string, _id: string): string {
  throw new Error("not implemented: storageKey");
}

/** `<uuid>/<uuid>` chữ thường. */
export function isStorageKey(_k: string): boolean {
  throw new Error("not implemented: isStorageKey");
}

/** Khoá hợp lệ → `root + sep + tenant + sep + id`; khác → null (`realpath` + so gốc ở driver). */
export function keyUnder(_root: string, _key: string, _sep: "/" | "\\"): string | null {
  throw new Error("not implemented: keyUnder");
}
