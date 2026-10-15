// HUB-FR-138 · HUB-FR-139 · HUB-FR-142 · FB1 §3.1, §4.2 · driver `filebox` của `AttachmentStorage`: ánh xạ
// stage/commit/discard/open/blob/remove/promote/list/link sang FileBox API (`filebox.client.ts`).
// stage = đọc body (đếm maxBytes 413 · FileInspector 415 · sha256) → `POST /files` (1 request) → giữ {fileId, versionId};
// commit = no-op (đã upload); discard = `DELETE /files/{id}` (hoàn tác khi INSERT DB lỗi ⇒ không mồ côi). list ⇒ [].
import { createHash } from "node:crypto";
import { type Logger, logger as rootLogger } from "../../lib/logger";
import { FileboxClient, type FileboxTokenSource } from "./filebox.client";
import {
  type AttachmentStorage,
  type ChunkInspector,
  parseFileboxLocator,
  type RemoveResult,
  type Staged,
  StorageKeyError,
  StorageRejected,
  StorageTooLarge,
  type StoredEntry,
} from "./storage";

export type FileboxStorageCfg = {
  url: string;
  org: string;
  token: FileboxTokenSource;
  caPath?: string;
  timeoutMs?: number;
  retryDelaysMs?: number[];
  log?: Logger;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_MS = [1_000, 2_000, 4_000];

/** `<tenant>/<id>` → `<id>` (tên gửi FileBox); `fb/<file_id>` → `<file_id>`. */
function fileIdOf(key: string): string {
  const fb = parseFileboxLocator(key);
  if (fb) return fb.fileId;
  return key.slice(key.indexOf("/") + 1);
}

/** Đọc trọn `body` vào bộ nhớ (≤ maxBytes): đếm (413), `inspect` (415), sha256. Không huỷ `body` (HTTP tự drain). */
async function readAll(
  body: ReadableStream<Uint8Array>,
  o: { maxBytes: number; inspect?: ChunkInspector },
): Promise<{ bytes: Uint8Array; size: number; sha256: string }> {
  const reader = body.getReader();
  const hash = createHash("sha256");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > o.maxBytes) throw new StorageTooLarge("attachment too large");
      if (o.inspect && !o.inspect.push(value)) throw new StorageRejected("attachment rejected");
      hash.update(value);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (o.inspect && !o.inspect.end()) throw new StorageRejected("attachment rejected");
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.length;
  }
  return { bytes, size, sha256: hash.digest("hex") };
}

class FileboxStorage implements AttachmentStorage {
  readonly driver = "filebox" as const;

  constructor(private readonly client: FileboxClient) {}

  async stage(
    key: string,
    body: ReadableStream<Uint8Array>,
    o: { maxBytes: number; inspect?: ChunkInspector },
  ): Promise<Staged> {
    const { bytes, size, sha256 } = await readAll(body, o);
    const { fileId, versionId } = await this.client.postFile(fileIdOf(key), bytes);
    const client = this.client;
    return {
      size,
      sha256,
      fileId,
      versionId,
      commit: async () => {},
      discard: async () => {
        await client.deleteFile(fileId).catch(() => {});
      },
    };
  }

  async open(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
    const bytes = await this.client.getContent(fileIdOf(key));
    if (bytes === null) return null;
    return { stream: new Blob([bytes]).stream(), size: bytes.length };
  }

  async blob(key: string, type: string): Promise<Blob | null> {
    const bytes = await this.client.getContent(fileIdOf(key));
    return bytes === null ? null : new Blob([bytes], { type });
  }

  /** Core-only: chỉ xoá khi locator `fb/<file_id>` (discard upload dở). Sweeper truyền `tenant/id` ⇒ no-op (xoá vòng đời file = Hardening). */
  async remove(key: string): Promise<RemoveResult> {
    const fb = parseFileboxLocator(key);
    return fb ? this.client.deleteFile(fb.fileId) : "missing";
  }

  /** Không có `.part` ở FileBox ⇒ no-op (PL13 chỉ cho local). */
  async promote(_key: string): Promise<void> {}

  /** FileBox không quét mồ côi như kho local ⇒ luôn rỗng (sweeper mồ côi no-op). */
  async list(_o: { after: string | null; limit: number }): Promise<StoredEntry[]> {
    return [];
  }

  async link(fileId: string): Promise<string | null> {
    return this.client.getLink(fileId);
  }
}

/** Driver `filebox` (chữ ký §3.1). `token.get()` null ⇒ fail-closed; locator đọc/xoá = `fb/<file_id>`. */
export function createFileboxStorage(cfg: FileboxStorageCfg): AttachmentStorage {
  if (!cfg.url || !cfg.org) throw new StorageKeyError("filebox storage: url and org required");
  const client = new FileboxClient({
    url: cfg.url,
    org: cfg.org,
    token: cfg.token,
    ...(cfg.caPath ? { caPath: cfg.caPath } : {}),
    timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryDelaysMs: cfg.retryDelaysMs ?? DEFAULT_RETRY_MS,
    log: cfg.log ?? rootLogger,
  });
  return new FileboxStorage(client);
}
