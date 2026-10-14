// HUB-FR-120 · ADM-FR-68 · PB-R02/R21 · C1 · luật thuần nguồn (không I/O): phạm vi tenant, host allowlist, ẩn path, cursor.
import {
  type SourceConfig,
  type SourceConfigParsed,
  type SourceConfigPublic,
  type SourcePin,
  type SourcePinPublic,
  sourceConfigOut,
} from "@ai/contracts/hub-admin";
import type { AuthUser } from "../../lib/auth.middleware";
import { appError } from "../../lib/errors";
import { validationError } from "../../lib/http";
import { sourceError } from "./sources.errors";

/** PB-R05 · host git cho phép (env `HUB_SOURCE_GIT_HOSTS`, mặc định github.com,gitlab.com). Khớp hostname tuyệt đối. */
export function allowedGitHosts(): Set<string> {
  const raw = process.env.HUB_SOURCE_GIT_HOSTS ?? "github.com,gitlab.com";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function gitHostAllowed(url: string): boolean {
  try {
    return allowedGitHosts().has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export const isPlatform = (u: AuthUser): boolean => u.role === "platform_admin";

/**
 * Tenant đích khi GHI (POST/PUT/DELETE/check): tenant_admin = phiên (gắn tenant khác ⇒ 404, không rò); platform_admin phải
 * nêu `tenant_id` (vắng ⇒ 422 VALIDATION_ERROR path tenant_id, C11).
 */
export function writeTenant(u: AuthUser, provided: string | undefined): string {
  if (u.role === "tenant_admin") {
    if (provided !== undefined && provided !== u.tenantId) throw sourceError("SOURCE_NOT_FOUND");
    return u.tenantId;
  }
  if (provided === undefined)
    throw validationError([{ path: ["tenant_id"], code: "custom", message: "tenant_id required" }]);
  return provided;
}

/** Tenant đích khi ĐỌC (GET/list): như `writeTenant` nhưng platform vắng `tenant_id` ⇒ 404 (không có phạm vi). */
export function readTenant(u: AuthUser, provided: string | undefined): string {
  if (u.role === "tenant_admin") {
    if (provided !== undefined && provided !== u.tenantId) throw sourceError("SOURCE_NOT_FOUND");
    return u.tenantId;
  }
  if (provided === undefined) throw sourceError("SOURCE_NOT_FOUND");
  return provided;
}

/** C1 · ẩn `config.path` của local_path cho non-platform_admin. */
export function publicConfig(
  config: SourceConfig,
  platform: boolean,
): SourceConfigParsed | SourceConfigPublic {
  if (platform || config.kind !== "local_path") return sourceConfigOut(config);
  return { kind: "local_path" };
}

/** C1 · ẩn `pin.path` của local_path cho non-platform_admin (git/library không bí mật). */
export function publicPin(
  pin: SourcePin | null,
  platform: boolean,
): SourcePin | SourcePinPublic | null {
  if (pin === null || platform || pin.kind !== "local_path") return pin;
  return { kind: "local_path", snapshot_id: pin.snapshot_id };
}

/** Cursor list = key cuối trang (opaque base64url). */
export const encodeCursor = (key: string): string => Buffer.from(key, "utf8").toString("base64url");

/** Cursor hỏng ⇒ 400 VALIDATION_ERROR. */
export function decodeCursor(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const key = Buffer.from(raw, "base64url").toString("utf8");
  if (!/^[a-z0-9-]{2,32}$/.test(key))
    throw validationError([{ path: ["cursor"], code: "custom", message: "Invalid cursor" }]);
  return key;
}

/** 409 version lệch (mã chung sẵn có). */
export function assertVersion(current: number, expected: number): void {
  if (current !== expected) throw appError("VERSION_CONFLICT");
}
