// HUB-FR-44 · H2c-R04, R05, AC-15 · L8, P5, P23 · driver `local` của `AttachmentStorage` (plan-rules §4, spec-decisions PL1).
// Gốc = `realpath(HUB_ATTACH_DIR)`; file `<gốc>/<tenant>/<id>`; ghi `<id>.part` (`wx`, 0600) → fsync → `commit` = rename.
// Mọi đường dẫn: khoá `<uuid>/<uuid>` + `realpath` thư mục tenant phải đúng `<gốc>/<tenant>` (symlink/junction ra ngoài
// ⇒ `StorageKeyError`). Windows (P23): bỏ quyền 0700/0600 (ACL), rename đích không tồn tại (uuid).
// Lỗi ở `createLocalStorage` không chứa đường dẫn (R04: log khởi động không in giá trị env) — chỉ mã lỗi `fs`.
import { createHash, randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import {
  chmod,
  type FileHandle,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import {
  type AttachmentStorage,
  type ChunkInspector,
  isUuidName,
  keyUnder,
  type Staged,
  StorageKeyError,
  StorageRejected,
  StorageTooLarge,
  type StoredEntry,
} from "./storage";

const PART = ".part";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

type Paths = { tenantDir: string; file: string; part: string };

const codeOf = (e: unknown): string =>
  typeof e === "object" && e !== null && "code" in e
    ? String((e as { code: unknown }).code)
    : "EUNKNOWN";

const missing = (e: unknown): boolean => {
  const c = codeOf(e);
  return c === "ENOENT" || c === "ENOTDIR";
};

/** Tạo gốc nếu thiếu (0700), siết quyền nhóm/khác (không win32), ghi thử một file; trả `realpath` gốc. */
async function prepareRoot(dir: string, win: boolean): Promise<string> {
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  const root = await realpath(dir);
  const st = await stat(root);
  if (!st.isDirectory()) throw Object.assign(new Error("not a directory"), { code: "ENOTDIR" });
  if (!win && (st.mode & 0o077) !== 0) await chmod(root, DIR_MODE);
  const probe = path.join(root, `.probe-${randomUUID()}`);
  const fh = await open(probe, "wx", FILE_MODE);
  await fh.close();
  await rm(probe, { force: true });
  return root;
}

/** Tạo `dir` nếu thiếu (0700 khi không `win32`), ghi thử; lỗi ⇒ ném (server thoát ≠ 0). */
export async function createLocalStorage(o: {
  dir: string;
  platform?: NodeJS.Platform;
}): Promise<AttachmentStorage> {
  const win = (o.platform ?? process.platform) === "win32";
  const p = win ? path.win32 : path.posix;
  if (!p.isAbsolute(o.dir)) throw new Error("attachment storage: dir must be absolute");
  try {
    return new LocalStorage(await prepareRoot(o.dir, win), win);
  } catch (e) {
    throw new Error(`attachment storage unusable (${codeOf(e)})`);
  }
}

/**
 * Ghi trọn `chunk` bằng `writeSync` (ghi thiếu ⇒ ghi tiếp): ghi đồng bộ vào page cache (khối ≤ vài MiB), đo RSS upload 20 MiB
 * thấp hơn `FileHandle.write` ~3,5 MiB/lần (Bun giữ bộ đệm ghi async) — spec-decisions "BUILD — B2/B3" B2-4.
 */
function writeAll(fh: FileHandle, chunk: Uint8Array): void {
  let off = 0;
  while (off < chunk.length) off += writeSync(fh.fd, chunk, off, chunk.length - off);
}

/**
 * Đọc `body` → `fh`: đếm byte (> `maxBytes` ⇒ `StorageTooLarge`), `inspect` (false ⇒ `StorageRejected`), sha256. Xong hay
 * lỗi đều nhả khoá đọc, **không huỷ** `body` (tầng HTTP còn đọc bỏ phần dư — spec-decisions "BUILD — B1" B1-3).
 */
async function pump(
  body: ReadableStream<Uint8Array>,
  fh: FileHandle,
  o: { maxBytes: number; inspect?: ChunkInspector },
): Promise<{ size: number; sha256: string }> {
  const reader = body.getReader();
  const hash = createHash("sha256");
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > o.maxBytes) throw new StorageTooLarge("attachment too large");
      if (o.inspect && !o.inspect.push(value)) throw new StorageRejected("attachment rejected");
      hash.update(value);
      writeAll(fh, value);
    }
  } finally {
    reader.releaseLock();
  }
  if (o.inspect && !o.inspect.end()) throw new StorageRejected("attachment rejected");
  await fh.sync();
  return { size, sha256: hash.digest("hex") };
}

class LocalStorage implements AttachmentStorage {
  readonly driver = "local" as const;
  readonly #sep: "/" | "\\";

  constructor(
    readonly root: string,
    readonly win: boolean,
  ) {
    this.#sep = win ? "\\" : "/";
  }

  /** Khoá → đường dẫn; `create` = tạo thư mục tenant (0700). Thư mục tenant không nằm đúng dưới gốc ⇒ `StorageKeyError`. */
  async #paths(key: string, create: boolean): Promise<Paths | null> {
    const file = keyUnder(this.root, key, this.#sep);
    if (!file) throw new StorageKeyError("invalid storage key");
    const tenantDir = path.dirname(file);
    if (create) await mkdir(tenantDir, { mode: DIR_MODE }).catch((e) => ignoreExists(e));
    let real: string;
    try {
      real = await realpath(tenantDir);
    } catch (e) {
      if (!create && missing(e)) return null;
      throw e;
    }
    if (real !== tenantDir) throw new StorageKeyError("tenant directory outside storage root");
    return { tenantDir, file, part: `${file}${PART}` };
  }

  /**
   * Ghi `<key>.part` (fsync, đóng). Lỗi giữa chừng ⇒ xoá `.part` rồi ném; `.part` đã có ⇒ lỗi `EEXIST`, không ghi đè.
   */
  async stage(
    key: string,
    body: ReadableStream<Uint8Array>,
    o: { maxBytes: number; inspect?: ChunkInspector },
  ): Promise<Staged> {
    const p = (await this.#paths(key, true)) as Paths;
    const fh = await open(p.part, "wx", FILE_MODE);
    let done: { size: number; sha256: string };
    try {
      done = await pump(body, fh, o);
    } catch (e) {
      await fh.close().catch(() => {});
      await rm(p.part, { force: true }).catch(() => {});
      throw e;
    }
    await fh.close();
    return {
      ...done,
      commit: () => rename(p.part, p.file),
      discard: () => rm(p.part, { force: true }),
    };
  }

  async open(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
    const file = await this.#existing(key);
    if (!file) return null;
    return { stream: file.blob.stream(), size: file.size };
  }

  async blob(key: string, type: string): Promise<Blob | null> {
    const file = await this.#existing(key);
    return file ? Bun.file(file.path, { type }) : null;
  }

  /** File đã commit (không `.part`) dưới gốc; không có ⇒ null. */
  async #existing(key: string): Promise<{ path: string; size: number; blob: Blob } | null> {
    const p = await this.#paths(key, false);
    if (!p) return null;
    const st = await stat(p.file).catch((e) => (missing(e) ? null : Promise.reject(e)));
    if (!st?.isFile()) return null;
    return { path: p.file, size: st.size, blob: Bun.file(p.file) };
  }

  async remove(key: string): Promise<void> {
    const p = await this.#paths(key, false);
    if (!p) return;
    await rm(p.file, { force: true });
    await rm(p.part, { force: true });
  }

  async promote(key: string): Promise<void> {
    const p = await this.#paths(key, false);
    if (!p) return;
    const has = await stat(p.file).then(
      () => true,
      (e) => (missing(e) ? false : Promise.reject(e)),
    );
    if (has) return rm(p.part, { force: true });
    await rename(p.part, p.file).catch((e) => (missing(e) ? undefined : Promise.reject(e)));
  }

  /** Mục sắp theo (key, partial); chỉ `<uuid>/<uuid>` và `<uuid>/<uuid>.part`; trang sau = key > `after`. */
  async list(o: { after: string | null; limit: number }): Promise<StoredEntry[]> {
    const out: StoredEntry[] = [];
    const afterTenant = o.after?.split("/")[0] ?? "";
    const tenants = (await readdir(this.root)).filter(isUuidName).sort();
    for (const t of tenants) {
      if (out.length >= o.limit) break;
      if (t < afterTenant) continue;
      await this.#listTenant(t, o.after, o.limit - out.length, out);
    }
    return out;
  }

  async #listTenant(t: string, after: string | null, n: number, out: StoredEntry[]): Promise<void> {
    const dir = path.join(this.root, t);
    const names = await readdir(dir).catch((e) => (missing(e) ? [] : Promise.reject(e)));
    const items = names
      .map((name) => entryName(t, name))
      .filter((x): x is { key: string; partial: boolean; name: string } => x !== null)
      .filter((x) => after === null || x.key > after)
      .sort((a, b) =>
        a.key === b.key ? Number(a.partial) - Number(b.partial) : a.key < b.key ? -1 : 1,
      );
    for (const x of items.slice(0, n)) {
      const st = await stat(path.join(dir, x.name)).catch(() => null);
      if (st?.isFile())
        out.push({ key: x.key, partial: x.partial, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
}

function ignoreExists(e: unknown): void {
  if (codeOf(e) !== "EEXIST") throw e;
}

/** Tên trong thư mục tenant → mục kho (`<uuid>` / `<uuid>.part`); tên lạ → null. */
function entryName(
  tenant: string,
  name: string,
): { key: string; partial: boolean; name: string } | null {
  const partial = name.endsWith(PART);
  const id = partial ? name.slice(0, -PART.length) : name;
  return isUuidName(id) ? { key: `${tenant}/${id}`, partial, name } : null;
}
