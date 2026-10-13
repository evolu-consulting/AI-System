// HUB-FR-68 · HUB-FR-04 · AC-H4b1-02 · AC-H4b1-06 · Q2 · plan H4b-1 §2.2, D1–D3, D10: mã hoá secrets của Hub (thuần).
// AES-256-GCM (`node:crypto`), IV 12 byte mới mỗi lần, ciphertext = bản mã ‖ tag 16, AAD = UTF-8
// `hub.secrets:<id>:<kind>:<tenant_id|->:<key_version>`. Khoá = `HUB_SECRETS_KEY` (base64 32 byte, KHÁC SECRET_MASTER_KEY).
// Message lỗi cố định — không bao giờ chứa khoá, giá trị hay bản mã.
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import type { HubSecretKind } from "@ai/contracts/hub-admin";

export type SecretKey = { version: number; key: Uint8Array };
export type SealedSecret = { ciphertext: Uint8Array; iv: Uint8Array; keyVersion: number };
export type SecretMeta = { id: string; kind: HubSecretKind; tenantId: string | null };
/** Lý do boot fatal (log `hub_secrets_key_invalid`, plan §4). */
export type HubKeyFailure = "missing" | "invalid" | "same_as_master" | "self_test";

const KEY_B64_RE = /^[A-Za-z0-9+/]{43}=$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGO = "aes-256-gcm";
const OPEN_FAIL = "hub-secrets: giải mã thất bại";
const MSG_MISSING = "HUB_SECRETS_KEY thiếu";
const MSG_INVALID = "HUB_SECRETS_KEY không hợp lệ";
const MSG_SAME = "HUB_SECRETS_KEY phải khác SECRET_MASTER_KEY";
const MSG_SELF_TEST = "HUB_SECRETS_KEY tự kiểm thất bại";
const NIL_ID = "00000000-0000-0000-0000-000000000000";

function decodeKey32(b64: string): Uint8Array | null {
  if (!KEY_B64_RE.test(b64)) return null;
  const raw = Buffer.from(b64, "base64");
  return raw.length === 32 ? new Uint8Array(raw) : null;
}

/** Thiếu/rỗng ⇒ "HUB_SECRETS_KEY thiếu"; sai base64 hoặc ≠ 32 byte ⇒ "HUB_SECRETS_KEY không hợp lệ". */
export function parseHubSecretsKey(b64: string | undefined, version = 1): SecretKey {
  if (b64 === undefined || b64 === "") throw new Error(MSG_MISSING);
  const key = decodeKey32(b64);
  if (!key) throw new Error(MSG_INVALID);
  return { version, key };
}

/** HUB-FR-04: trùng byte với master ⇒ ném. Master vắng/sai định dạng ⇒ không so được ⇒ không ném. */
export function assertDistinctFromMaster(hub: SecretKey, masterB64: string | undefined): void {
  if (masterB64 === undefined || masterB64 === "") return;
  const master = decodeKey32(masterB64);
  if (!master || master.length !== hub.key.length) return;
  if (timingSafeEqual(master, hub.key)) throw new Error(MSG_SAME);
}

/**
 * D3 · AAD gắn bản mã với đúng (id, kind, tenant, key_version) — tráo hàng/loại/tenant ⇒ giải mã hỏng.
 * id/tenant hạ chữ thường: `z.uuid()` nhận UUID HOA, Postgres trả thường ⇒ AAD phải độc lập kiểu chữ (RV1 #1).
 */
export function hubSecretAad(m: SecretMeta, keyVersion: number): Uint8Array {
  const tenant = m.tenantId === null ? "-" : m.tenantId.toLowerCase();
  const aad = `hub.secrets:${m.id.toLowerCase()}:${m.kind}:${tenant}:${keyVersion}`;
  return new Uint8Array(Buffer.from(aad, "utf8"));
}

const defaultRand = (n: number): Uint8Array => new Uint8Array(randomBytes(n));

/** IV 12 byte mới mỗi lần (`rand` tiêm được cho test); ciphertext = bản mã ‖ tag 16. */
export function sealHubSecret(
  k: SecretKey,
  m: SecretMeta,
  value: string,
  rand: (n: number) => Uint8Array = defaultRand,
): SealedSecret {
  const iv = rand(IV_BYTES);
  const c = createCipheriv(ALGO, k.key, iv);
  c.setAAD(hubSecretAad(m, k.version));
  const ct = Buffer.concat([c.update(value, "utf8"), c.final(), c.getAuthTag()]);
  return { ciphertext: new Uint8Array(ct), iv: new Uint8Array(iv), keyVersion: k.version };
}

/** Sai khoá/AAD/tag/iv/key_version/độ dài ⇒ Error("hub-secrets: giải mã thất bại") (message cố định). */
export function openHubSecret(k: SecretKey, m: SecretMeta, s: SealedSecret): string {
  const ct = Buffer.from(s.ciphertext);
  if (ct.length < TAG_BYTES || s.iv.length !== IV_BYTES) throw new Error(OPEN_FAIL);
  try {
    const d = createDecipheriv(ALGO, k.key, s.iv);
    d.setAAD(hubSecretAad(m, s.keyVersion));
    d.setAuthTag(ct.subarray(ct.length - TAG_BYTES));
    return Buffer.concat([d.update(ct.subarray(0, ct.length - TAG_BYTES)), d.final()]).toString(
      "utf8",
    );
  } catch {
    throw new Error(OPEN_FAIL);
  }
}

/** Boot: seal/open thử với id nil; hỏng ⇒ ném (message cố định). */
export function selfTestHubSecretsKey(k: SecretKey): void {
  const m: SecretMeta = { id: NIL_ID, kind: "provider_api_key", tenantId: null };
  const probe = "hub-secrets-self-test";
  try {
    if (openHubSecret(k, m, sealHubSecret(k, m, probe)) === probe) return;
  } catch {
    // rơi xuống ném message cố định
  }
  throw new Error(MSG_SELF_TEST);
}

/** Boot (plan §4): parse → khác master → tự kiểm. Trả khoá hoặc lý do (không bao giờ chứa giá trị). */
export function checkHubSecretsKey(
  hubB64: string | undefined,
  masterB64: string | undefined,
): { ok: true; key: SecretKey } | { ok: false; reason: HubKeyFailure } {
  let key: SecretKey;
  try {
    key = parseHubSecretsKey(hubB64);
  } catch (err) {
    return { ok: false, reason: (err as Error).message === MSG_MISSING ? "missing" : "invalid" };
  }
  try {
    assertDistinctFromMaster(key, masterB64);
  } catch {
    return { ok: false, reason: "same_as_master" };
  }
  try {
    selfTestHubSecretsKey(key);
  } catch {
    return { ok: false, reason: "self_test" };
  }
  return { ok: true, key };
}
