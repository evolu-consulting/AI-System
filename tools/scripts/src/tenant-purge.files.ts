// tool-tenant-purge · FileBox của tenant: xoá SAU khi DB đã commit (DB hỏng ⇒ file còn nguyên). Nguồn id: (1) cột file của dữ liệu
// tenant đọc trước khi xoá (hub.attachments.filebox_file_id, <gói>.files.file_id, storage_key `fb/…`), (2) liệt kê org `t_<tenant>`
// của FileBox. Id còn được dữ liệu tenant khác tham chiếu ⇒ không xoá. Kết quả (còn sót) ghi vào file trạng thái ⇒ chạy lại idempotent.
import { readFile, writeFile } from "node:fs/promises";
import { logger } from "../../../apps/hub-api/src/lib/logger";
import { FileboxClient } from "../../../apps/hub-api/src/modules/attachments/filebox.client";
import { envFileboxToken } from "../../../apps/hub-api/src/modules/attachments/filebox-token";
import { orgForTenant } from "./tenant-purge.rules";

/** Cổng FileBox (test thay bằng giả). */
export type FileStore = {
  /** Id file đang sẵn sàng của org (đã xoá thì không còn trong danh sách). */
  list(org: string): Promise<string[]>;
  remove(fileId: string): Promise<"deleted" | "missing">;
};

export type FileState = {
  tenantId: string;
  name: string;
  at: string;
  /** Id cần xoá (gộp từ DB + org); `leftovers` = chưa xoá được. */
  fileIds: string[];
  leftovers: string[];
  skipped: string[];
};

export type FileReport = {
  deleted: number;
  missing: number;
  leftovers: string[];
  skipped: string[];
};

/** Xoá từng id (lỗi một id không chặn id khác); id còn được tham chiếu ⇒ `skipped`. Sau cùng liệt kê lại org ⇒ còn sót. */
export async function purgeFiles(
  store: FileStore,
  tenantId: string,
  ids: readonly string[],
  referenced: ReadonlySet<string>,
): Promise<FileReport> {
  const org = orgForTenant(tenantId);
  const r: FileReport = { deleted: 0, missing: 0, leftovers: [], skipped: [] };
  const tried = new Set<string>();
  // Danh sách org trả tối đa 1000 id/lượt ⇒ lặp tới khi không còn id mới (id đã thử không thử lại trong cùng lượt chạy).
  let batch = [...new Set([...ids, ...(await store.list(org))])];
  while (batch.length) {
    for (const id of batch.sort()) {
      tried.add(id);
      if (referenced.has(id)) {
        r.skipped.push(id);
        continue;
      }
      try {
        if ((await store.remove(id)) === "deleted") r.deleted++;
        else r.missing++;
      } catch {
        r.leftovers.push(id);
      }
    }
    batch = (await store.list(org)).filter((id) => !tried.has(id));
  }
  const still = (await store.list(org)).filter((id) => !referenced.has(id));
  r.leftovers = [...new Set([...r.leftovers, ...still])].sort();
  return r;
}

export async function readState(path: string): Promise<FileState | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as FileState;
  } catch {
    return null;
  }
}

export async function writeState(path: string, s: FileState): Promise<void> {
  await writeFile(path, `${JSON.stringify(s, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

/** FileBox thật từ env (`FILEBOX_URL` + `FILEBOX_TOKEN`, CA `FILEBOX_CA`); thiếu ⇒ null (bỏ phần file, báo rõ). */
export function envFileStore(env: NodeJS.ProcessEnv = process.env): FileStore | null {
  const url = env.FILEBOX_URL?.replace(/\/+$/, "");
  const token = env.FILEBOX_TOKEN;
  if (!url || !token) return null;
  const client = new FileboxClient({
    url,
    org: env.FILEBOX_ORG ?? "tenant-purge",
    token: envFileboxToken(token),
    ...(env.FILEBOX_CA ? { caPath: env.FILEBOX_CA } : {}),
    timeoutMs: 15_000,
    retryDelaysMs: [500, 1_000],
    log: logger,
  });
  return {
    async list(org) {
      const out: string[] = [];
      const res = await fetch(`${url}/files?org=${encodeURIComponent(org)}&limit=1000`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`filebox list ${res.status}`);
      for (const f of (await res.json()) as { file_id?: string }[])
        if (f.file_id) out.push(f.file_id);
      return out;
    },
    remove: (id) => client.deleteFile(id),
  };
}
