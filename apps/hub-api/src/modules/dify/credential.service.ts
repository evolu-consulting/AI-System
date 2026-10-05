// HUB-FR-89 · H2a-R11, R17 · Q1/P1, P6 · app-key Dify của workflow: hàm DB `hub.workflow_secret` (SECURITY DEFINER, chỉ
// `hub_ro` EXECUTE — gọi dưới `SET LOCAL ROLE hub_ro`, transaction riêng ngắn) + giải mã `lib/secret-crypto` ngay trước
// khi gọi Dify; không cache bản rõ (R17). Thiếu secret / giải mã lỗi / vắng master key → `CredentialError`
// (`NOT_CONFIGURED`, plan-errors §2 reason `credential`). Log chỉ `workflow_id` + lý do, không bản mã/giá trị.
import { createCipheriv, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "../../lib/db";
import type { Logger } from "../../lib/logger";
import { decryptSecret, parseMasterKey, type SecretKey, secretAad } from "../../lib/secret-crypto";

export type CredentialFailure = "secret_missing" | "secret_decrypt_failed" | "master_key_missing";

export class CredentialError extends Error {
  readonly code = "NOT_CONFIGURED" as const;
  readonly reason = "credential" as const;
  constructor(readonly failure: CredentialFailure) {
    super(`dify credential: ${failure}`);
    this.name = "CredentialError";
  }
}

export const isCredentialError = (e: unknown): e is CredentialError => e instanceof CredentialError;

type SecretRow = {
  secret_id: string;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  key_version: number;
};

/** `SELECT … FROM hub.workflow_secret($1)` dưới role `hub_ro` (P1); 0 hoặc 1 dòng. */
export async function readWorkflowSecret(db: Db, workflowId: string): Promise<SecretRow | null> {
  return db.db.transaction(async (tx) => {
    await tx.execute(sql`set local role hub_ro`);
    const rows = (await tx.execute(sql`select secret_id, ciphertext, iv, key_version
      from hub.workflow_secret(${workflowId})`)) as unknown as SecretRow[];
    return rows[0] ?? null;
  });
}

export type CredentialServiceDeps = { db: Db; masterKey: SecretKey | null; log: Logger };

export class CredentialService {
  constructor(private readonly d: CredentialServiceDeps) {}

  /** App-key bản rõ của workflow. Người gọi dùng ngay cho một lời gọi Dify, không lưu. */
  async apiKey(workflowId: string): Promise<string> {
    if (!this.d.masterKey) return this.fail("master_key_missing", workflowId);
    const row = await readWorkflowSecret(this.d.db, workflowId);
    if (!row) return this.fail("secret_missing", workflowId);
    try {
      return decryptSecret(this.d.masterKey, row.secret_id, {
        ciphertext: row.ciphertext,
        iv: row.iv,
        keyVersion: Number(row.key_version),
      });
    } catch {
      return this.fail("secret_decrypt_failed", workflowId);
    }
  }

  private fail(failure: CredentialFailure, workflowId: string): never {
    this.d.log.warn(failure, { workflow_id: workflowId });
    throw new CredentialError(failure);
  }
}

const SELF_TEST_ID = "00000000-0000-0000-0000-000000000000";
const SELF_TEST_VALUE = "hub-self-test";

/**
 * Tự kiểm lúc khởi động (plan §8; quyết định B-B4-3): mã hoá một giá trị cố định bằng khoá vừa nạp theo đúng định dạng
 * Admin (AES-256-GCM, iv 12, tag 16 nối sau, AAD `admin.secrets:<id>:<v>`) rồi giải lại bằng `decryptSecret` của Hub.
 * Bắt: khoá sai độ dài/định dạng, đường giải mã hỏng. Ném Error không chứa khoá.
 */
export function selfTestMasterKey(k: SecretKey): void {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k.key, iv);
  c.setAAD(secretAad(SELF_TEST_ID, k.version));
  const ct = Buffer.concat([c.update(SELF_TEST_VALUE, "utf8"), c.final(), c.getAuthTag()]);
  const back = decryptSecret(k, SELF_TEST_ID, { ciphertext: ct, iv, keyVersion: k.version });
  if (back !== SELF_TEST_VALUE) throw new Error("secret-crypto: tự kiểm thất bại");
}

/** `SECRET_MASTER_KEY` → khoá đã tự kiểm; vắng → null (mọi lời gọi Dify `NOT_CONFIGURED`). Sai → ném (server: fatal). */
export function loadMasterKey(b64: string | undefined): SecretKey | null {
  if (b64 === undefined || b64 === "") return null;
  const k = parseMasterKey(b64);
  selfTestMasterKey(k);
  return k;
}

/**
 * Dò khớp khoá với Admin (chỉ cảnh báo, không fatal — một secret hỏng không được làm sập Hub): giải thử secret của một
 * workflow mới nhất có `secret_id` (workflow chưa gắn secret không phải dấu hiệu lệch khoá). Trả `ok` / `mismatch` /
 * `none` (chưa có secret nào).
 */
export async function probeMasterKey(
  db: Db,
  k: SecretKey,
  log: Logger,
): Promise<"ok" | "mismatch" | "none"> {
  const rows = (await db.db.transaction(async (tx) => {
    await tx.execute(sql`set local role hub_ro`);
    return tx.execute(sql`select id from admin.workflows where secret_id is not null
      order by updated_at desc limit 1`);
  })) as unknown as { id: string }[];
  const wf = rows[0]?.id;
  if (!wf) return "none";
  const quiet: Logger = { ...log, warn: () => {} };
  try {
    await new CredentialService({ db, masterKey: k, log: quiet }).apiKey(wf);
    return "ok";
  } catch {
    log.warn("secret_master_key_mismatch", { workflow_id: wf });
    return "mismatch";
  }
}
