// HUB-FR-68 · HUB-FR-69 · HUB-BR-15 · CR-060 · Q1, Q7 · plan H4b-1 §2.1, D13, D17: luật thuần secrets (không I/O) —
// phạm vi theo loại, quyền theo route, tenant đích route tenant, snapshot audit không giá trị, entity_name, cursor.
import { type Role, UuidSchema } from "@ai/contracts";
import { HUB_SECRET_KINDS, type HubSecretKind } from "@ai/contracts/hub-admin";
import type { AuthUser } from "../../lib/auth.middleware";
import { appError } from "../../lib/errors";
import { validationError } from "../../lib/http";

export type { HubSecretKind };
export type SecretRoute = "studio" | "tenant";
export type SecretCursor = [string, string, string];

/** provider ⇒ tenantId null; source_credential ⇒ khác null; kh_api_key ⇒ cả hai (Q7). */
export function secretScopeOk(kind: HubSecretKind, tenantId: string | null): boolean {
  if (kind === "provider_api_key") return tenantId === null;
  if (kind === "source_credential") return tenantId !== null;
  return true;
}

/** studio: chỉ platform_admin, mọi kind. tenant: tenant_admin|platform_admin, CHỈ source_credential. member ⇒ false. */
export function canManageSecret(role: Role, kind: HubSecretKind, route: SecretRoute): boolean {
  if (route === "studio") return role === "platform_admin";
  return (role === "platform_admin" || role === "tenant_admin") && kind === "source_credential";
}

/**
 * D13 · như `writeTenant`/`readTenant` của nguồn: tenant_admin = tenant phiên (gửi tenant khác ⇒ NOT_FOUND, không rò tồn
 * tại); platform_admin phải nêu `tenant_id` — vắng: write ⇒ VALIDATION_ERROR path tenant_id, read ⇒ NOT_FOUND.
 */
export function credentialTenant(
  u: AuthUser,
  provided: string | undefined,
  mode: "read" | "write",
): string {
  if (u.role !== "platform_admin") {
    if (provided !== undefined && provided.toLowerCase() !== u.tenantId.toLowerCase())
      throw appError("NOT_FOUND");
    return u.tenantId;
  }
  if (provided !== undefined) return provided;
  if (mode === "read") throw appError("NOT_FOUND");
  throw validationError([{ path: ["tenant_id"], code: "custom", message: "tenant_id required" }]);
}

export type SecretAuditSnapshot = {
  name: string;
  kind: HubSecretKind;
  tenant_id: string | null;
  version: number;
};

/** HUB-FR-69 · before/after audit: chỉ 4 khoá, không bao giờ có value/ciphertext/iv (dựng mới, không spread). */
export function secretAuditSnapshot(r: {
  name: string;
  kind: HubSecretKind;
  tenantId: string | null;
  version: number;
}): SecretAuditSnapshot {
  return { name: r.name, kind: r.kind, tenant_id: r.tenantId, version: r.version };
}

/** `<kind>:<name>` (hub-audit clip ≤ 200). */
export function secretEntityName(kind: HubSecretKind, name: string): string {
  return `${kind}:${name}`;
}

/** Cursor list = base64url JSON [kind, lower(name), id]. */
export function encodeSecretCursor(k: SecretCursor): string {
  return Buffer.from(JSON.stringify(k), "utf8").toString("base64url");
}

const KINDS: readonly string[] = HUB_SECRET_KINDS;

/** RV1 #2: [kind ∈ HUB_SECRET_KINDS, string, uuid] — khác ⇒ không phải cursor (để SQL không nhận rác). */
function isCursorTuple(v: unknown): v is SecretCursor {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === "string")) return false;
  const [kind, , id] = v as string[];
  return KINDS.includes(kind ?? "") && UuidSchema.safeParse(id).success;
}

/** Hỏng / sai hình ⇒ undefined (trang đầu, không ném) — plan §2.1. */
export function decodeSecretCursor(raw: string | undefined): SecretCursor | undefined {
  if (raw === undefined || !/^[A-Za-z0-9_-]+$/.test(raw)) return undefined;
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (isCursorTuple(v)) return [v[0], v[1], v[2]];
  } catch {
    // JSON hỏng ⇒ trang đầu
  }
  return undefined;
}
