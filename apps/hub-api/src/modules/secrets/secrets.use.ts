// HUB-FR-68 · HUB-FR-04 · HUB-BR-30 · AC-H4b1-07 · plan H4b-1 §2.3, D12, D16 · dùng giá trị secret NỘI BỘ (không route):
// đọc bản mã qua `hub.secret_material(id, kind, tenant)` (transaction ngắn, scope system), giải mã, gọi `fn(value)`; không
// cache bản rõ. Lỗi ⇒ log warn `{secret_id, kind, failure}` rồi ném `SecretUseError` (message không id/giá trị).
// NGƯỜI GỌI phải truyền tenant của run (không lấy từ input người dùng); giá trị chỉ sống trong `fn` — không đưa vào payload
// job, `work/<job_id>/`, prompt, trace, audit, `detail` lỗi.
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import type { Logger } from "../../lib/logger";
import { openHubSecret, type SecretKey } from "./secrets.crypto";
import { readMaterial } from "./secrets.repo";
import type { HubSecretKind } from "./secrets.rules";

export type SecretRef = { id: string; kind: HubSecretKind; tenantId: string | null };
export type SecretUseFailure = "key_missing" | "secret_missing" | "decrypt_failed";

export class SecretUseError extends Error {
  readonly code = "NOT_CONFIGURED";
  readonly reason = "credential";
  constructor(readonly failure: SecretUseFailure) {
    super(`hub secret: ${failure}`);
    this.name = "SecretUseError";
  }
}

export const isSecretUseError = (e: unknown): e is SecretUseError => e instanceof SecretUseError;

export type HubSecretReaderDeps = { db: Db; key: SecretKey | null; log: Pick<Logger, "warn"> };

export class HubSecretReader {
  constructor(private readonly d: HubSecretReaderDeps) {}

  #fail(ref: SecretRef, failure: SecretUseFailure): never {
    this.d.log.warn("hub_secret_use_failed", { secret_id: ref.id, kind: ref.kind, failure });
    throw new SecretUseError(failure);
  }

  /** Giải đúng (id, kind, tenant) rồi gọi `fn`; trả kết quả của `fn`. Lỗi của `fn` đi thẳng ra (không bọc). */
  async useSecret<T>(ref: SecretRef, fn: (value: string) => Promise<T>): Promise<T> {
    const key = this.d.key;
    if (!key) return this.#fail(ref, "key_missing");
    const m = await withHubScope(this.d.db, { kind: "system" }, (tx) => readMaterial(tx, ref));
    if (!m) return this.#fail(ref, "secret_missing");
    let value: string;
    try {
      value = openHubSecret(key, ref, {
        ciphertext: m.ciphertext,
        iv: m.iv,
        keyVersion: Number(m.key_version),
      });
    } catch {
      return this.#fail(ref, "decrypt_failed");
    }
    return fn(value);
  }
}
