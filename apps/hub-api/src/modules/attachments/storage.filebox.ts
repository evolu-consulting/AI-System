// HUB-FR-44 · H2c-R04, R05, R29 · CR-filebox · driver `filebox` của `AttachmentStorage`: nội dung nằm ở FileBox (API v1,
// F:\workspace\Filebox-INTEGRATION.md — repo POC `Filebox/`), Hub giữ ánh xạ khoá `<tenant>/<id>` → `file_id` ở `BlobIndex`
// (bảng `hub.attachment_blobs`, `storage.filebox.index.ts`) vì FileBox chỉ tìm được file theo `file_id` nó cấp.
// Hai pha như `local` (R05): `stage` = kiểm + tải lên + hàng `partial`; `commit` = bỏ `partial` (sau khi DB commit);
// `discard`/`remove` = xoá ở FileBox rồi xoá hàng. Khoá FileBox chỉ đi trong header `Authorization`, không vào URL/log/lỗi.
// Cỡ file ≤ `ATTACH_MAX_BYTES` (20 MiB) ⇒ gom trong bộ nhớ rồi `POST /files` một lần (không dùng luồng nhiều phần).
import { createHash } from "node:crypto";
import {
  type AttachmentStorage,
  type ChunkInspector,
  isStorageKey,
  type Staged,
  StorageKeyError,
  StorageRejected,
  StorageTooLarge,
  type StoreCursor,
  type StoredEntry,
} from "./storage";

/** Một hàng ánh xạ: `fileId` null = đã giữ chỗ, chưa tải lên xong. */
export type BlobRow = {
  key: string;
  fileId: string | null;
  partial: boolean;
  size: number;
  createdMs: number;
};

/** Ánh xạ khoá → file FileBox. Bản SQL: `sqlBlobIndex` (scope `system`); test dùng bản trong bộ nhớ. */
export interface BlobIndex {
  /** Thêm hàng `partial`, chưa có file; khoá đã có ⇒ false. */
  reserve(key: string): Promise<boolean>;
  attach(key: string, fileId: string, size: number): Promise<void>;
  commit(key: string): Promise<void>;
  get(key: string): Promise<BlobRow | null>;
  drop(key: string): Promise<void>;
  /** Sắp theo (key, partial); sau `after` (cặp). */
  list(after: StoreCursor | null, limit: number): Promise<BlobRow[]>;
}

export interface FileboxClient {
  upload(name: string, bytes: Uint8Array): Promise<{ fileId: string; size: number }>;
  /** null = FileBox không có file (404). */
  content(fileId: string): Promise<Response | null>;
  /** Không có = ok. */
  remove(fileId: string): Promise<void>;
  /** Kiểm khoá + đường tới FileBox (lúc khởi động). */
  probe(): Promise<void>;
}

const TIMEOUT_MS = 60_000;
const RETRY_WAIT_MS = [1000, 2000, 4000];
const FILE_ID_RE = /^[0-9a-f]{16,64}$/;

/** Lỗi FileBox chỉ mang thao tác + mã HTTP (không URL, không khoá). */
export class FileboxError extends Error {}

type Conn = {
  url: string;
  headers: Record<string, string>;
  fetch: typeof fetch;
  ca?: string;
  tls?: { ca: string };
};

/** Một lần gọi; lỗi mạng/timeout ⇒ null. */
async function once(c: Conn, path: string, init: RequestInit): Promise<Response | null> {
  const headers = { ...c.headers, ...(init.headers as Record<string, string> | undefined) };
  try {
    return await c.fetch(`${c.url}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(c.tls ? { tls: c.tls } : {}),
    } as RequestInit);
  } catch {
    return null;
  }
}

/** GET/DELETE thử lại khi 5xx/mạng (1, 2, 4 s); POST tải lên không thử lại (tránh tạo file trùng). */
async function send(c: Conn, op: string, path: string, init: RequestInit = {}): Promise<Response> {
  if (c.ca && !c.tls) c.tls = { ca: await Bun.file(c.ca).text() };
  const retries = init.method === "POST" ? 0 : RETRY_WAIT_MS.length;
  for (let attempt = 0; ; attempt++) {
    const res = await once(c, path, init);
    if (res && res.status < 500) return res;
    if (attempt >= retries)
      throw new FileboxError(`filebox ${op} failed (${res ? res.status : "network"})`);
    await Bun.sleep(RETRY_WAIT_MS[attempt] ?? 4000);
  }
}

async function expectOk(op: string, res: Response): Promise<Response> {
  if (res.ok) return res;
  await res.body?.cancel();
  throw new FileboxError(`filebox ${op} failed (${res.status})`);
}

/** Client API v1 (khoá chỉ trong header `Authorization`). */
export function fileboxClient(o: {
  url: string;
  token: string;
  org: string;
  ca?: string | undefined;
  fetch?: typeof fetch;
}): FileboxClient {
  const c: Conn = {
    url: o.url,
    headers: { Authorization: `Bearer ${o.token}` },
    fetch: o.fetch ?? fetch,
    ...(o.ca ? { ca: o.ca } : {}),
  };
  const call = (op: string, path: string, init?: RequestInit) => send(c, op, path, init);
  return {
    async upload(name, bytes) {
      const q = new URLSearchParams({ org: o.org, name });
      const res = await expectOk(
        "upload",
        await call("upload", `/files?${q}`, {
          method: "POST",
          body: bytes,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );
      const f = (await res.json()) as { file_id?: unknown; size?: unknown };
      if (typeof f.file_id !== "string" || !FILE_ID_RE.test(f.file_id))
        throw new FileboxError("filebox upload failed (bad response)");
      return { fileId: f.file_id, size: Number(f.size ?? bytes.length) };
    },
    async content(fileId) {
      const res = await call("download", `/files/${fileId}/content`);
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      return expectOk("download", res);
    },
    async remove(fileId) {
      const res = await call("delete", `/files/${fileId}`, { method: "DELETE" });
      if (res.status !== 404) await expectOk("delete", res);
      await res.body?.cancel();
    },
    async probe() {
      const q = new URLSearchParams({ org: o.org, limit: "1" });
      const res = await expectOk("probe", await call("probe", `/files?${q}`));
      await res.body?.cancel();
    },
  };
}

/** Kiểm khoá FileBox (lỗi ⇒ ném, server thoát ≠ 0) rồi trả driver. */
export async function createFileboxStorage(o: {
  client: FileboxClient;
  index: BlobIndex;
}): Promise<AttachmentStorage> {
  await o.client.probe();
  return new FileboxStorage(o.client, o.index);
}

/** Đọc hết `body` (≤ `maxBytes`) + `inspect` + sha256; không huỷ `body` (như `local`, B1-3). */
async function collect(
  body: ReadableStream<Uint8Array>,
  o: { maxBytes: number; inspect?: ChunkInspector },
): Promise<{ bytes: Uint8Array; sha256: string }> {
  const reader = body.getReader();
  const hash = createHash("sha256");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > o.maxBytes) throw new StorageTooLarge("attachment too large");
      if (o.inspect && !o.inspect.push(value)) throw new StorageRejected("attachment rejected");
      hash.update(value);
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (o.inspect && !o.inspect.end()) throw new StorageRejected("attachment rejected");
  return { bytes: Buffer.concat(parts), sha256: hash.digest("hex") };
}

/** Tên file trên FileBox: không có `/` (FileBox lấy basename). */
const remoteName = (key: string): string => key.replace("/", "_");

class FileboxStorage implements AttachmentStorage {
  readonly driver = "filebox" as const;

  constructor(
    readonly client: FileboxClient,
    readonly index: BlobIndex,
  ) {}

  /** Kiểm + gom trước (lỗi ⇒ chưa đụng FileBox/index), giữ chỗ khoá, tải lên; lỗi tải ⇒ bỏ hàng rồi ném. */
  async stage(
    key: string,
    body: ReadableStream<Uint8Array>,
    o: { maxBytes: number; inspect?: ChunkInspector },
  ): Promise<Staged> {
    if (!isStorageKey(key)) throw new StorageKeyError("invalid storage key");
    const { bytes, sha256 } = await collect(body, o);
    if (!(await this.index.reserve(key))) throw new Error("attachment storage: key exists");
    try {
      const f = await this.client.upload(remoteName(key), bytes);
      await this.index.attach(key, f.fileId, bytes.length);
    } catch (e) {
      await this.index.drop(key).catch(() => {});
      throw e;
    }
    return {
      size: bytes.length,
      sha256,
      commit: () => this.index.commit(key),
      discard: () => this.remove(key),
    };
  }

  async open(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
    const row = await this.#committed(key);
    const res = row ? await this.client.content(row.fileId) : null;
    return res?.body && row ? { stream: res.body, size: row.size } : null;
  }

  async blob(key: string, type: string): Promise<Blob | null> {
    const row = await this.#committed(key);
    const res = row ? await this.client.content(row.fileId) : null;
    return res ? new Blob([await res.arrayBuffer()], { type }) : null;
  }

  async #committed(key: string): Promise<(BlobRow & { fileId: string }) | null> {
    if (!isStorageKey(key)) throw new StorageKeyError("invalid storage key");
    const row = await this.index.get(key);
    return row && !row.partial && row.fileId ? { ...row, fileId: row.fileId } : null;
  }

  async remove(key: string): Promise<void> {
    if (!isStorageKey(key)) throw new StorageKeyError("invalid storage key");
    const row = await this.index.get(key);
    if (!row) return;
    if (row.fileId) await this.client.remove(row.fileId);
    await this.index.drop(key);
  }

  /** Hàng `partial` có file ⇒ commit; chưa có file (tải dở) ⇒ bỏ hàng; không có hàng = ok. */
  async promote(key: string): Promise<void> {
    if (!isStorageKey(key)) throw new StorageKeyError("invalid storage key");
    const row = await this.index.get(key);
    if (!row?.partial) return;
    await (row.fileId ? this.index.commit(key) : this.index.drop(key));
  }

  async list(o: { after: string | StoreCursor | null; limit: number }): Promise<StoredEntry[]> {
    const after = typeof o.after === "string" ? { key: o.after, partial: true } : o.after;
    const rows = await this.index.list(after, o.limit);
    return rows.map((r) => ({
      key: r.key,
      partial: r.partial,
      size: r.size,
      mtimeMs: r.createdMs,
    }));
  }
}
