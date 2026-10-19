// HUB-FR-138 · HUB-FR-139 · HUB-FR-141 · FB1 §3.1, §4.5, §4.6 · client HTTP tới FileBox (dịch vụ file nội bộ nền MinIO).
// Mọi fetch cùng origin `FILEBOX_URL` (`fileboxUrlOk`); pin CA qua `caPath` (https); KHÔNG tắt kiểm chứng TLS.
// Token Bearer từ nguồn chỉ-ghi (`FileboxTokenSource`); 401/403 ⇒ làm mới ĐÚNG một lần rồi thử lại; vắng token ⇒ fail-closed.
// Retry backoff (idempotent GET/DELETE) cho 5xx/lỗi mạng; POST /files KHÔNG retry (tránh upload trùng ⇒ mồ côi).
import { readFile } from "node:fs/promises";
import type { Logger } from "../../lib/logger";
import { FileboxUnavailable, fileboxRetryable, StorageTooLarge } from "./storage";

export type FileboxTokenSource = {
  get(): Promise<string | null>;
  refresh(): Promise<string | null>;
};

export type FileboxClientCfg = {
  url: string;
  org: string;
  token: FileboxTokenSource;
  caPath?: string;
  timeoutMs: number;
  retryDelaysMs: number[];
  log: Logger;
};

/** Chỉ cùng origin (scheme+host+port) với `FILEBOX_URL` và không có userinfo ⇒ được gọi/theo (HUB-FR-141, AC-09 e8). */
export function fileboxUrlOk(base: string, url: string): boolean {
  let b: URL;
  let u: URL;
  try {
    b = new URL(base);
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username !== "" || u.password !== "") return false;
  return u.origin === b.origin && u.protocol === b.protocol;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Attempt = { res: Response | null; status: number | null };

export class FileboxClient {
  #ca: string | null | undefined; // undefined = chưa đọc; null = không dùng (http/mock)

  constructor(private readonly cfg: FileboxClientCfg) {}

  /** `POST /files?org=&name=` (1 request, không retry). 2xx ⇒ {fileId, versionId}; 413 ⇒ `StorageTooLarge`; khác ⇒ fail-closed.
   * FileBox thật trả 200 (không 201); nhận mọi 2xx cho tương thích cả server thật lẫn mock (201). */
  async postFile(name: string, bytes: Uint8Array): Promise<{ fileId: string; versionId: string }> {
    const q = `/files?org=${encodeURIComponent(this.cfg.org)}&name=${encodeURIComponent(name)}`;
    const res = await this.#send("POST", q, { body: bytes, retryable: false });
    if (res.status === 413) throw new StorageTooLarge("filebox 413");
    if (!res.ok) throw new FileboxUnavailable(`filebox post ${res.status}`);
    const j = (await res.json()) as { file_id?: string; version_id?: string };
    if (!j.file_id || !j.version_id) throw new FileboxUnavailable("filebox post: missing ids");
    return { fileId: j.file_id, versionId: j.version_id };
  }

  /** `GET /files/{id}/content` (idempotent) ⇒ toàn bộ byte (200/206); 404 ⇒ null (content-missing); khác ⇒ fail-closed. */
  async getContent(fileId: string): Promise<Uint8Array | null> {
    const res = await this.#send("GET", `/files/${encodeURIComponent(fileId)}/content`, {
      retryable: true,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new FileboxUnavailable(`filebox content ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** `GET /files/{id}/link` (idempotent) ⇒ URL tải tuyệt đối (`FILEBOX_URL + /d/…`); 404 ⇒ null. */
  async getLink(fileId: string): Promise<string | null> {
    const res = await this.#send("GET", `/files/${encodeURIComponent(fileId)}/link`, {
      retryable: true,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new FileboxUnavailable(`filebox link ${res.status}`);
    const j = (await res.json()) as { url?: string };
    if (!j.url) throw new FileboxUnavailable("filebox link: missing url");
    return `${this.cfg.url}${j.url}`;
  }

  /** `DELETE /files/{id}` (idempotent) ⇒ 2xx `deleted` (server thật 200, mock 204); 404 ⇒ `missing` (đã xoá, không ném). */
  async deleteFile(fileId: string): Promise<"deleted" | "missing"> {
    const res = await this.#send("DELETE", `/files/${encodeURIComponent(fileId)}`, {
      retryable: true,
    });
    if (res.status === 404) return "missing";
    if (res.ok) return "deleted";
    throw new FileboxUnavailable(`filebox delete ${res.status}`);
  }

  /** Gửi có token + xử lý 401/403 (làm mới 1 lần) + retry (idempotent). Trả Response (status đã chốt) hoặc ném fail-closed. */
  async #send(
    method: string,
    path: string,
    o: { body?: Uint8Array; retryable: boolean },
  ): Promise<Response> {
    let token = await this.cfg.token.get();
    if (!token) {
      this.cfg.log.warn("filebox-token-missing", {});
      throw new FileboxUnavailable("filebox token missing");
    }
    let at = await this.#attempt(method, path, o.body, token);
    if (at.status === 401 || at.status === 403) {
      token = await this.cfg.token.refresh();
      if (!token) {
        this.cfg.log.warn("filebox-token-missing", {});
        throw new FileboxUnavailable("filebox token missing after refresh");
      }
      at = await this.#attempt(method, path, o.body, token);
      if (at.status === 401 || at.status === 403)
        throw new FileboxUnavailable("filebox auth failed");
    }
    if (o.retryable) at = await this.#retry(method, path, o.body, token, at);
    if (!at.res) throw new FileboxUnavailable("filebox network error");
    return at.res;
  }

  async #retry(
    method: string,
    path: string,
    body: Uint8Array | undefined,
    token: string,
    first: Attempt,
  ): Promise<Attempt> {
    let at = first;
    for (const d of this.cfg.retryDelaysMs) {
      if (!fileboxRetryable(at.status)) break;
      await sleep(d);
      at = await this.#attempt(method, path, body, token);
    }
    return at;
  }

  /** Một lần fetch; lỗi mạng/timeout ⇒ `{res:null, status:null}` (retryable). */
  async #attempt(
    method: string,
    path: string,
    body: Uint8Array | undefined,
    token: string,
  ): Promise<Attempt> {
    const url = `${this.cfg.url}${path}`;
    if (!fileboxUrlOk(this.cfg.url, url)) throw new FileboxUnavailable("filebox egress blocked");
    try {
      const res = await fetch(url, await this.#init(method, body, token));
      return { res, status: res.status };
    } catch {
      return { res: null, status: null };
    }
  }

  async #init(method: string, body: Uint8Array | undefined, token: string): Promise<RequestInit> {
    const init: RequestInit & { tls?: { ca: string } } = {
      method,
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
      ...(body ? { body: body as Uint8Array<ArrayBuffer> } : {}), // lib DOM (tsconfig.tests) đòi ArrayBuffer
    };
    const ca = await this.#caText();
    if (ca) init.tls = { ca };
    return init;
  }

  /** Đọc CA một lần (https + `caPath`); http/mock ⇒ null. */
  async #caText(): Promise<string | null> {
    if (this.#ca !== undefined) return this.#ca;
    this.#ca =
      this.cfg.caPath && this.cfg.url.startsWith("https:")
        ? await readFile(this.cfg.caPath, "utf8").catch(() => null)
        : null;
    return this.#ca;
  }
}
