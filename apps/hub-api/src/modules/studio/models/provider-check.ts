// HUB-FR-66 · AC-H4b2-02 · spec H4b2 §3 A (`POST /providers/:id/check`) · plan §3.2, §4, D7, D8, D9, D13 · "Kiểm tra key"
// (api) / "Kiểm tra lại" (subscription). Đọc hàng NGOÀI transaction ghi → api: key chỉ sống trong callback `useSecret`
// (fake ⇒ trong tiến trình; hãng ⇒ `fetch` tiêm, hạn 10 s, `redirect:"error"`, key ở header) · subscription: xoá mốc probe
// rồi chờ probe của Runtime ≤ 10 s theo đồng hồ (`sleep` tiêm, không giữ transaction) → transaction ngắn audit `check`
// (không bump, `after` không `message`). Log chỉ trường cố định. 404/409 không audit.
import type { ProviderCheckResult } from "@ai/contracts/studio";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { Db } from "../../../lib/db";
import { appError } from "../../../lib/errors";
import type { HubAuditWriter } from "../../../lib/hub-audit";
import type { Logger } from "../../../lib/logger";
import { secretsNotConfigured } from "../../secrets/secrets.errors";
import { type HubSecretReader, isSecretUseError } from "../../secrets/secrets.use";
import { username } from "../studio-write";
import { modelError } from "./models.errors";
import { isReadonlyProvider } from "./models.rules";
import { clearProbe, dbNow, type ProbeStateRow, readProbeState } from "./provider-check.repo";
import {
  CHECK_TIMEOUT_MS,
  type CheckHit,
  checkOutcome,
  fakeCheck,
  hitOfFetchError,
  subscriptionOutcome,
  vendorCheckRequest,
} from "./provider-check.rules";
import { type ProviderDbRow, readProvider } from "./providers.repo";

/** Nhịp đọc lại `provider_state` khi chờ probe (plan §3.2). */
export const PROBE_POLL_MS = 500;
/** Chỉ đọc ≤ 64 KB thân lỗi hãng (thông điệp giữ 500 ký tự). */
const BODY_MAX = 64 * 1024;

export type ProviderCheckDeps = {
  db: Db;
  audit: HubAuditWriter;
  reader: Pick<HubSecretReader, "useSecret">;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  log: Pick<Logger, "info">;
  /** Đồng hồ đơn điệu (ms) cho hạn chờ + latency; test tiêm. */
  clock?: () => number;
  now?: () => Date;
};

type CheckRow = Pick<ProviderDbRow, "id" | "key" | "kind" | "vendor" | "baseUrl" | "secretId">;

/** Kết quả không có lời gọi (unsupported / secret_unreadable / requested): mã HTTP null. */
function noHit(
  status: ProviderCheckResult["status"],
  errorCode: ProviderCheckResult["error_code"],
  latencyMs: number | null,
  at: Date,
): ProviderCheckResult {
  return {
    status,
    error_code: errorCode,
    http_status: null,
    message: null,
    latency_ms: latencyMs === null ? null : Math.max(0, Math.round(latencyMs)),
    checked_at: at.toISOString(),
  };
}

/** Đọc tối đa `max` byte rồi huỷ phần còn lại (hãng trả thân lớn không giữ bộ nhớ). */
export async function readLimited(res: Response, max = BODY_MAX): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  while (n < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, max));
}

export class ProviderCheckService {
  constructor(private readonly d: ProviderCheckDeps) {}

  #ms(): number {
    return this.d.clock?.() ?? performance.now();
  }

  #now(): Date {
    return this.d.now?.() ?? new Date();
  }

  async check(actor: AuthUser, id: string): Promise<ProviderCheckResult> {
    const row = await withHubScope(this.d.db, { kind: "system" }, (tx) => readProvider(tx, id));
    if (!row) throw appError("NOT_FOUND");
    if (isReadonlyProvider(row.vendor)) throw modelError("PROVIDER_READONLY");
    const r = row.kind === "subscription" ? await this.#recheck(row.key) : await this.apiCheck(row);
    await this.#audit(actor, row, r);
    // Tên trường không chứa "key": logger che mọi trường khớp /key/ (logger.ts SENSITIVE_KEY); giá trị là mã provider, không phải secret.
    this.d.log.info("provider.check", {
      provider: row.key,
      status: r.status,
      error_code: r.error_code,
      http_status: r.http_status,
      latency_ms: r.latency_ms,
    });
    return r;
  }

  /** api · key thiếu khoá Hub ⇒ 409 NOT_CONFIGURED; secret vắng/giải mã lỗi ⇒ `secret_unreadable` (không gọi hãng). */
  async apiCheck(row: CheckRow): Promise<ProviderCheckResult> {
    if (row.secretId === null) return noHit("error", "secret_unreadable", null, this.#now());
    const ref = { id: row.secretId, kind: "provider_api_key" as const, tenantId: null };
    try {
      return await this.d.reader.useSecret(ref, (key) => this.#hit(row, key));
    } catch (e) {
      if (!isSecretUseError(e)) throw e;
      if (e.failure === "key_missing") throw secretsNotConfigured();
      return noHit("error", "secret_unreadable", null, this.#now());
    }
  }

  async #hit(row: CheckRow, key: string): Promise<ProviderCheckResult> {
    const t = this.#ms();
    if (row.vendor === "fake")
      return checkOutcome(fakeCheck(key), key, this.#ms() - t, this.#now());
    const req = vendorCheckRequest(row.vendor, row.baseUrl, key);
    if (!req) return noHit("unsupported", null, null, this.#now());
    const hit = await this.#fetch(req);
    return checkOutcome(hit, key, this.#ms() - t, this.#now());
  }

  async #fetch(req: { url: string; headers: Record<string, string> }): Promise<CheckHit> {
    try {
      const res = await this.d.fetch(req.url, {
        method: "GET",
        headers: req.headers,
        redirect: "error",
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (res.status >= 200 && res.status < 300) {
        await res.body?.cancel().catch(() => {});
        return { status: res.status, body: "" };
      }
      return { status: res.status, body: await readLimited(res).catch(() => "") };
    } catch (e) {
      return hitOfFetchError(e);
    }
  }

  /** subscription · D9: xoá `last_probe_at`/`last_ok_at` (transaction riêng, commit trước khi chờ) rồi chờ probe. */
  async #recheck(providerKey: string): Promise<ProviderCheckResult> {
    const t0 = await withHubScope(this.d.db, { kind: "system" }, async (tx) => {
      const at = await dbNow(tx);
      await clearProbe(tx, providerKey);
      return at;
    });
    const read = () =>
      withHubScope(this.d.db, { kind: "system" }, (tx) => readProbeState(tx, providerKey), {
        accessMode: "read only",
      });
    return this.pollProbe(read, t0);
  }

  /**
   * Mỗi vòng `sleep(500)` rồi đọc; probe mới (≥ t0, giờ DB) ⇒ kết quả; quá 10 s theo đồng hồ **hoặc** đủ
   * 20 vòng (= 10 s danh nghĩa; `sleep` tiêm ở test không chờ thật) ⇒ `requested`.
   */
  async pollProbe(
    read: () => Promise<ProbeStateRow | undefined>,
    t0: Date,
  ): Promise<ProviderCheckResult> {
    const start = this.#ms();
    const at = () => new Date(t0.getTime() + Math.max(0, this.#ms() - start));
    const rounds = Math.ceil(CHECK_TIMEOUT_MS / PROBE_POLL_MS);
    for (let i = 0; i < rounds && this.#ms() - start < CHECK_TIMEOUT_MS; i++) {
      await this.d.sleep(PROBE_POLL_MS);
      const out = subscriptionOutcome(await read(), t0, at());
      if (out) return out;
    }
    return noHit("requested", null, this.#ms() - start, at());
  }

  /** Audit `check` không bump (`hubConfigVersion` null), `after` không có `message` (D13). */
  async #audit(actor: AuthUser, row: CheckRow, r: ProviderCheckResult): Promise<void> {
    await withHubScope(this.d.db, { kind: "system" }, async (tx) =>
      this.d.audit.insert(tx, {
        tenantId: null,
        actorId: actor.userId,
        actorUsername: await username(tx, actor.userId),
        actorRole: actor.role,
        action: "check",
        entity: "provider",
        entityId: row.id,
        entityName: row.key,
        hubConfigVersion: null,
        before: null,
        after: { status: r.status, error_code: r.error_code, http_status: r.http_status },
        summary: { kind: row.kind },
      }),
    );
  }
}
