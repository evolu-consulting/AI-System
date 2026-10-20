// I1 · file: nguồn = thư mục `contract_files` của mgmt-app (bản chép chỉ-đọc của volume `apidata`), một file mỗi
// `<org>/<hđ>/`; đích = FileBox (cutover thật — client org `t_<tenant>` tiêm từ ngoài) hoặc thư mục cục bộ (bản sao seed;
// `file_id = local:<sha256>`). Không xoá gì ở nguồn.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { FileSink } from "../application/ports";

export type DirFile = { name: string; bytes: Uint8Array };

const sha256 = (b: Uint8Array): string => new Bun.CryptoHasher("sha256").update(b).digest("hex");

/** Đọc file duy nhất trong `<root>/<rel>/`; đường dẫn ra ngoài `root` (`..`) ⇒ null. */
export function createDirSource(root: string) {
  const base = resolve(root);
  return {
    async readDir(rel: string): Promise<DirFile | null> {
      const dir = resolve(base, rel);
      if (dir !== base && !dir.startsWith(base + sep)) return null;
      const names = await readdir(dir).catch(() => [] as string[]);
      const name = names.sort()[0];
      if (!name) return null;
      return { name, bytes: new Uint8Array(await readFile(join(dir, name))) };
    },
  };
}

export function createDirSink(root: string): FileSink {
  const base = resolve(root);
  return {
    async put(_org, _name, bytes) {
      const h = sha256(bytes);
      await mkdir(base, { recursive: true });
      await writeFile(join(base, h), bytes);
      return { fileId: `local:${h}`, versionId: null };
    },
    async readBack(fileId) {
      const h = fileId.startsWith("local:") ? fileId.slice(6) : "";
      if (!/^[0-9a-f]{64}$/.test(h)) return null;
      return new Uint8Array(await readFile(join(base, h)).catch(() => Buffer.alloc(0)));
    },
  };
}

/** Phần client FileBox cần (khớp `PackFileboxClient` của hub-api). */
export type FileboxLike = {
  postFile(name: string, bytes: Uint8Array): Promise<{ fileId: string; versionId: string }>;
  getContent(fileId: string): Promise<Uint8Array | null>;
};

/**
 * niti-filebox · đích FileBox thật: org `t_<tenant>` (đúng org upload của app — use case truyền). `readBack` đọc lại bytes qua
 * client của org hàng `contracts.files` (đối soát sha256, cả khi chạy lại không upload).
 */
export function createFileboxSink(client: (org: string) => FileboxLike): FileSink {
  return {
    put: async (org, name, bytes) => client(org).postFile(name, bytes),
    readBack: async (fileId, org) => client(org).getContent(fileId),
  };
}

export { sha256 };
