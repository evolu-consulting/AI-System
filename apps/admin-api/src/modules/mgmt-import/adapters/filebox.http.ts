// niti-filebox · I1 · client HTTP tối thiểu tới FileBox cho importer (cùng hợp đồng `apps/hub-api/.../filebox.client.ts`, HUB-FR-138/141):
// `POST /files?org=&name=` (KHÔNG retry — tránh upload trùng ⇒ mồ côi), `GET /files/{id}/content` (đọc lại để đối soát sha256),
// `DELETE /files/{id}` (dọn khi ghi hàng lỗi). Cùng origin `FILEBOX_URL`, Bearer từ env (không log), CA pin qua `FILEBOX_CA` (https),
// không tắt kiểm chứng TLS. admin-api không import được mã hub-api (depcruise) ⇒ bản thu gọn ở đây (TECH-DEBT: gộp vào package chung).
import { readFile } from "node:fs/promises";

export type FileboxCfg = { url: string; token: string; caPath?: string; timeoutMs?: number };

export class FileboxHttpError extends Error {
  constructor(readonly status: number | null) {
    super("FILEBOX_UNAVAILABLE");
  }
}

/** Cùng origin + không userinfo (HUB-FR-141). */
export function sameOrigin(base: string, url: string): boolean {
  try {
    const b = new URL(base);
    const u = new URL(url);
    return u.username === "" && u.password === "" && u.origin === b.origin;
  } catch {
    return false;
  }
}

export function createFileboxHttp(cfg: FileboxCfg) {
  const base = cfg.url.replace(/\/+$/, "");
  let ca: Promise<string | null> | null = null;
  const caText = () => {
    ca ??=
      cfg.caPath && base.startsWith("https:")
        ? readFile(cfg.caPath, "utf8").catch(() => null)
        : Promise.resolve(null);
    return ca;
  };
  async function send(method: string, path: string, body?: Uint8Array): Promise<Response> {
    const url = `${base}${path}`;
    if (!sameOrigin(base, url)) throw new FileboxHttpError(null);
    const tls = await caText();
    const init: RequestInit & { tls?: { ca: string } } = {
      method,
      headers: { authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 60_000),
      ...(body ? { body: body as Uint8Array<ArrayBuffer> } : {}),
      ...(tls ? { tls: { ca: tls } } : {}),
    };
    return fetch(url, init).catch(() => {
      throw new FileboxHttpError(null);
    });
  }
  /** Client theo org (`t_<tenant>` — như upload của app, PK-FR-06). */
  return (org: string) => ({
    async postFile(name: string, bytes: Uint8Array) {
      const q = `/files?org=${encodeURIComponent(org)}&name=${encodeURIComponent(name)}`;
      const res = await send("POST", q, bytes);
      if (!res.ok) throw new FileboxHttpError(res.status);
      const j = (await res.json()) as { file_id?: string; version_id?: string };
      if (!j.file_id || !j.version_id) throw new FileboxHttpError(res.status);
      return { fileId: j.file_id, versionId: j.version_id };
    },
    async getContent(fileId: string): Promise<Uint8Array | null> {
      const res = await send("GET", `/files/${encodeURIComponent(fileId)}/content`);
      if (res.status === 404) return null;
      if (!res.ok) throw new FileboxHttpError(res.status);
      return new Uint8Array(await res.arrayBuffer());
    },
    async deleteFile(fileId: string): Promise<void> {
      const res = await send("DELETE", `/files/${encodeURIComponent(fileId)}`);
      if (!res.ok && res.status !== 404) throw new FileboxHttpError(res.status);
    },
  });
}
