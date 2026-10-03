// ADM-FR-51, ADM-FR-52, ADM-BR-09 · M4-R12, M4-R13 · hàm thuần đọc/khôi phục audit (plan-rules §A2–A3). Không I/O.
import type { AuditAction, AuditEntity, Role } from "@ai/contracts";

export type AuditFilter =
  | { kind: "tenant"; tenantId: string }
  | { kind: "system" }
  | { kind: "all" };

/**
 * tenant_admin: vắng | tenant mình → tenant(own); tenant khác / "system" → not_found (BR-09: không lộ tồn tại).
 * platform_admin: vắng → all; "system" → system (tenant_id NULL); uuid → tenant.
 */
export function resolveAuditFilter(
  actor: { role: Role; tenantId: string },
  tenantParam: string | undefined,
): AuditFilter | "not_found" {
  if (actor.role === "platform_admin") {
    if (tenantParam === undefined) return { kind: "all" };
    if (tenantParam === "system") return { kind: "system" };
    return { kind: "tenant", tenantId: tenantParam };
  }
  if (tenantParam === undefined || tenantParam === actor.tenantId)
    return { kind: "tenant", tenantId: actor.tenantId };
  return "not_found";
}

const RESTORABLE_ENTITIES: ReadonlySet<AuditEntity> = new Set([
  "command",
  "workflow",
  "feature",
  "group",
  "quota",
]);
const RESTORABLE_ACTIONS: ReadonlySet<AuditAction> = new Set(["update", "delete", "restore"]);

/** Dòng `delete` đã bị một dòng mới hơn cùng `(entity, entity_id)` vượt (xoá → khôi phục → xoá lại). */
const staleDelete = (e: { action: AuditAction; latest?: boolean }): boolean =>
  e.action === "delete" && e.latest === false;

/**
 * Q7, Q8: chỉ platform_admin, 5 thực thể cấu hình, action update/delete/restore, hàng có snapshot đầy đủ; dòng
 * `delete` còn phải là dòng mới nhất của `(entity, entity_id)` (`latest`, vắng = true) — không khôi phục bản xoá cũ.
 */
export function canRestore(
  role: Role,
  e: { entity: AuditEntity; action: AuditAction; snapshot: boolean; latest?: boolean },
): boolean {
  return (
    role === "platform_admin" &&
    RESTORABLE_ENTITIES.has(e.entity) &&
    RESTORABLE_ACTIONS.has(e.action) &&
    e.snapshot &&
    !staleDelete(e)
  );
}

/**
 * Chỉ khôi phục thay đổi mới nhất (update/restore) hoặc thực thể đã xoá (delete) — plan §4.4. Dòng `delete` không
 * phải mới nhất của `(entity, entity_id)` (`latest === false`) → NOT_RESTORABLE (version không được lùi).
 */
export function restoreCheck(
  e: { action: AuditAction; entityVersion: number | null; latest?: boolean },
  cur: { exists: boolean; version: number | null },
): "ok" | "NOT_RESTORABLE" | "VERSION_CONFLICT" {
  if (e.action === "delete") return cur.exists || staleDelete(e) ? "NOT_RESTORABLE" : "ok";
  if (!cur.exists) return "NOT_RESTORABLE";
  return cur.version === e.entityVersion ? "ok" : "VERSION_CONFLICT";
}

const SEQ_RE = /^[1-9]\d{0,18}$/;
const SEQ_MAX = 9223372036854775807n;

/** Cursor = base64url của `seq` thập phân (chuỗi — không qua number, giữ chính xác > 2^53). */
export function encodeCursor(seq: string): string {
  return Buffer.from(seq, "utf8").toString("base64url");
}

/** Không phải base64url chuẩn của một bigint dương hợp lệ → null (route trả 400 VALIDATION_ERROR). */
export function decodeCursor(s: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const v = Buffer.from(s, "base64url").toString("utf8");
  if (!SEQ_RE.test(v) || BigInt(v) > SEQ_MAX) return null;
  return encodeCursor(v) === s ? v : null;
}

/** Ngày VN (Asia/Ho_Chi_Minh, không DST, M4-R01) → mốc UTC. */
const VN_OFFSET_MS = 420 * 60_000;
const DAY_MS = 86_400_000;
export const AUDIT_DEFAULT_DAYS = 30;

const vnDayStart = (d: string): Date => new Date(Date.parse(`${d}T00:00:00Z`) - VN_OFFSET_MS);
const vnToday = (now: Date): string =>
  new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Khoảng `[since, until)` theo ngày VN, `to` tính trọn ngày. Vắng `from` → (to ?? hôm nay VN) lùi 29 ngày
 * (= 30 ngày gần nhất tính cả ngày cuối). Vắng `to` → không chặn trên. from > to → "invalid".
 */
export function auditRange(
  q: { from?: string; to?: string },
  now: Date,
): { since: Date; until: Date | null } | "invalid" {
  if (q.from && q.to && q.from > q.to) return "invalid";
  const until = q.to ? new Date(vnDayStart(q.to).getTime() + DAY_MS) : null;
  const end = q.to ?? vnToday(now);
  const since = q.from
    ? vnDayStart(q.from)
    : new Date(vnDayStart(end).getTime() - (AUDIT_DEFAULT_DAYS - 1) * DAY_MS);
  return { since, until };
}
