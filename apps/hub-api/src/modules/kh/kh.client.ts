// HUB-FR-131 · HUB-FR-132 · HUB-FR-133 · HUB-BR-40 · CR-073 · plan K1 §3.2, D1, D5, D9 · client KnowledgeHub (giao thức spec
// §3.0): mỗi lời gọi chạy lại `khUrlPolicy`; khoá chung đọc bằng `useSecret` NGAY quanh `fetch` ⇒ header `X-KH-Key` (không log,
// không đưa vào lỗi); `redirect:"error"`; hạn `AbortSignal.any([timeout, deadline?])`; thân trả về đọc tối đa 1 MiB.
// Lỗi ⇒ `KhCallError {code, status?}` message cố định `kh: <code>`. `KhProjectsCache` (D5): 300 s, khoá `(connection_id,
// version)`, single-flight, chỉ cache thành công.
import {
  KH_KEY_HEADER,
  KH_PROJECTS_CACHE_MS,
  KH_QUERY_K,
  KH_QUERY_MAX_CHARS,
  type KhWarningCode,
} from "@ai/contracts/hub-admin";
import type { KhConfig } from "../../config/env";
import type { HubSecretReader } from "../secrets/secrets.use";
import type { KhHit } from "./kh.check.rules";
import { classifyKhFailure, type KhFailure, khUrlPolicy, parseKhProjects } from "./kh.rules";

/** Phần kết nối client cần (đọc từ `kh_connections`). */
export type KhConn = { id: string; baseUrl: string; secretId: string; version: number };
export type KhClientDeps = {
  secrets: Pick<HubSecretReader, "useSecret">;
  cfg: KhConfig;
  /** `APP_ENV ∈ {development, test}` (fail-closed) — cho phép http loopback. */
  dev: boolean;
  fetch?: typeof fetch;
};
export type KhCallOpts = {
  /** gửi khoá chung (mặc định true). */
  key?: boolean;
  /** hạn tổng của luồng gọi (vd 20 s của "Kiểm tra"). */
  signal?: AbortSignal;
};

/** Message cố định — không URL, không khoá, không thân trả về. */
export class KhCallError extends Error {
  constructor(
    readonly code: KhWarningCode,
    readonly status?: number,
  ) {
    super(`kh: ${code}`);
    this.name = "KhCallError";
  }
}

export const isKhCallError = (e: unknown): e is KhCallError => e instanceof KhCallError;

const BODY_MAX_BYTES = 1_048_576;

/** Đọc thân tối đa `BODY_MAX_BYTES`; không phải JSON / quá cỡ ⇒ null. */
async function readJson(res: Response): Promise<unknown> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

const is2xx = (s: number): boolean => s >= 200 && s < 300;
const failOf = (h: KhHit): KhFailure => (typeof h === "string" ? h : h.status);

export class KhClient {
  readonly #fetch: typeof fetch;
  constructor(private readonly d: KhClientDeps) {
    this.#fetch = d.fetch ?? fetch;
  }

  /** URL gốc đã chuẩn hoá; ngoài chính sách ⇒ `KhCallError("disabled")` (kết nối không dùng được lúc gọi, D3). */
  baseUrl(conn: Pick<KhConn, "baseUrl">): string {
    const r = khUrlPolicy(conn.baseUrl, this.d.cfg.allowedOrigins, { dev: this.d.dev });
    if (!r.ok) throw new KhCallError("disabled");
    return r.baseUrl;
  }

  /**
   * Một lời gọi thô (cho "Kiểm tra", plan §3.1): trả `{status, body}` | "timeout" | "network", không ném theo mã HTTP.
   * Ném: `KhCallError("disabled")` khi URL ngoài chính sách; `SecretUseError` khi không đọc được khoá (`key` = true).
   */
  async hit(
    conn: KhConn,
    method: "GET" | "POST",
    path: string,
    opts: KhCallOpts & { body?: unknown } = {},
  ): Promise<KhHit> {
    const url = `${this.baseUrl(conn)}${path}`;
    const send = (key: string | null) => this.#send(url, method, key, opts);
    if (opts.key === false) return send(null);
    return this.d.secrets.useSecret(
      { id: conn.secretId, kind: "kh_api_key", tenantId: null },
      (value) => send(value),
    );
  }

  async #send(
    url: string,
    method: "GET" | "POST",
    key: string | null,
    opts: KhCallOpts & { body?: unknown },
  ): Promise<KhHit> {
    const timeout = AbortSignal.timeout(this.d.cfg.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
    const headers: Record<string, string> = { accept: "application/json" };
    if (key !== null) headers[KH_KEY_HEADER] = key;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    try {
      const res = await this.#fetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        redirect: "error",
        signal,
      });
      return { status: res.status, body: await readJson(res) };
    } catch {
      return signal.aborted ? "timeout" : "network";
    }
  }

  /** Có khoá (mặc định); non-2xx / timeout / network ⇒ `KhCallError(classifyKhFailure)`. Trả thân (null = không phải JSON). */
  async get(conn: KhConn, path: string, opts: KhCallOpts = {}): Promise<unknown> {
    return this.#ok(await this.#hitOrDisabled(conn, "GET", path, opts));
  }

  async post(conn: KhConn, path: string, body: unknown, opts: KhCallOpts = {}): Promise<unknown> {
    return this.#ok(await this.#hitOrDisabled(conn, "POST", path, { ...opts, body }));
  }

  /** `GET /projects` có khoá ⇒ id project khoá thấy; thân sai ⇒ `KhCallError("invalid", 200)`. */
  async projects(conn: KhConn, signal?: AbortSignal): Promise<string[]> {
    const ids = parseKhProjects(await this.get(conn, "/projects", { signal }));
    if (ids === null) throw new KhCallError("invalid", 200);
    return ids;
  }

  /** `POST /vector/query {text, project, k: 8, max_chars: 1500}` ⇒ thân thô (người gọi `khPackHits`). */
  query(
    conn: KhConn,
    q: { text: string; project: string },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const body = { text: q.text, project: q.project, k: KH_QUERY_K, max_chars: KH_QUERY_MAX_CHARS };
    return this.post(conn, "/vector/query", body, { signal });
  }

  /** `POST /vector/add` (thân `khWorklogBody`); `id` cố định ⇒ ghi lại = ghi đè. */
  async add(conn: KhConn, body: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    await this.post(conn, "/vector/add", body, { signal });
  }

  /** Không đọc được khoá ở đường chạy (không phải "Kiểm tra") ⇒ kết nối không dùng được ⇒ `disabled`. */
  async #hitOrDisabled(
    conn: KhConn,
    method: "GET" | "POST",
    path: string,
    opts: KhCallOpts & { body?: unknown },
  ): Promise<KhHit> {
    try {
      return await this.hit(conn, method, path, opts);
    } catch (e) {
      if (isKhCallError(e)) throw e;
      throw new KhCallError("disabled");
    }
  }

  #ok(h: KhHit): unknown {
    if (typeof h !== "string" && is2xx(h.status)) return h.body;
    const f = failOf(h);
    throw new KhCallError(classifyKhFailure(f), typeof f === "number" ? f : undefined);
  }
}

type CacheEntry = { at: number; ids: string[] };

/** D5 · cache `GET /projects` theo `(connection_id, version)`; đổi `version` ⇒ khoá mới (bỏ khoá cũ cùng id). */
export class KhProjectsCache {
  readonly #hits = new Map<string, CacheEntry>();
  readonly #inflight = new Map<string, Promise<string[]>>();
  constructor(
    private readonly client: Pick<KhClient, "projects">,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = KH_PROJECTS_CACHE_MS,
  ) {}

  /** Lỗi (`KhCallError`) không cache; lời gọi đồng thời cùng khoá dùng chung một lần gọi KH. */
  get(conn: KhConn, signal?: AbortSignal): Promise<string[]> {
    const k = `${conn.id}:${conn.version}`;
    const hit = this.#hits.get(k);
    if (hit && this.now() - hit.at < this.ttlMs) return Promise.resolve([...hit.ids]);
    const running = this.#inflight.get(k);
    if (running) return running.then((ids) => [...ids]);
    const p = this.client
      .projects(conn, signal)
      .then((ids) => {
        this.#store(conn.id, k, ids);
        return ids;
      })
      .finally(() => this.#inflight.delete(k));
    this.#inflight.set(k, p);
    return p.then((ids) => [...ids]);
  }

  clear(): void {
    this.#hits.clear();
  }

  #store(id: string, k: string, ids: string[]): void {
    for (const key of this.#hits.keys()) if (key.startsWith(`${id}:`)) this.#hits.delete(key);
    this.#hits.set(k, { at: this.now(), ids });
  }
}
