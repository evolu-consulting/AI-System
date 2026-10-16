// DLC-R11 · client HTTP chỉ-đọc tới engine AI SDLC (DLC) cho kênh chat (BFF: trình duyệt không gọi engine). Xác thực tuỳ
// chọn: `client_credentials` Keycloak realm `dlc` (token giữ trong bộ nhớ, làm mới trước `exp`); 401 → làm mới, thử lại một
// lần. Hết giờ 5 s mỗi lời gọi. Không log token/secret/URL có secret; lỗi chỉ mang status.
import { readFileSync } from "node:fs";

export type DlcEngineConfig = {
  url: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  /** Chứng chỉ (PEM) của Keycloak tự ký. */
  caFile?: string;
};

export class DlcEngineError extends Error {
  constructor(readonly status: number) {
    super(`dlc engine ${status}`);
  }
}

export type DlcJson = Record<string, unknown>;

const TIMEOUT_MS = 5_000;
const EARLY_S = 30;

export class DlcEngine {
  #token: string | null = null;
  #until = 0;
  readonly #ca: string | undefined;

  constructor(private readonly cfg: DlcEngineConfig) {
    this.#ca = cfg.caFile ? readFileSync(cfg.caFile, "utf8") : undefined;
  }

  async get(path: string): Promise<DlcJson> {
    let res = await this.#send(path, false);
    if (res.status === 401 && this.cfg.clientId) res = await this.#send(path, true);
    if (!res.ok) throw new DlcEngineError(res.status);
    const body = (await res.json().catch(() => ({}))) as unknown;
    return body && typeof body === "object" ? (body as DlcJson) : {};
  }

  async #send(path: string, refresh: boolean): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = await this.#bearer(refresh);
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await fetch(this.cfg.url.replace(/\/$/, "") + path, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new DlcEngineError(0);
    }
  }

  async #bearer(refresh: boolean): Promise<string | null> {
    const { tokenUrl, clientId, clientSecret } = this.cfg;
    if (!tokenUrl || !clientId || !clientSecret) return null;
    if (!refresh && this.#token && Date.now() < this.#until) return this.#token;
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    const init: RequestInit & { tls?: { ca: string } } = {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(this.#ca ? { tls: { ca: this.#ca } } : {}),
    };
    const res = await fetch(tokenUrl, init).catch(() => null);
    if (!res?.ok) throw new DlcEngineError(res?.status ?? 0);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    this.#token = body.access_token ?? null;
    this.#until = Date.now() + Math.max((body.expires_in ?? 60) - EARLY_S, 5) * 1000;
    return this.#token;
  }
}
