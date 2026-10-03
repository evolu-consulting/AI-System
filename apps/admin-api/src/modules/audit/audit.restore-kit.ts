// ADM-FR-52 · M4-R13 · Q7 · đồ nghề chung cho adapter khôi phục `<m>.restore.ts` (plan M4 §4.4): dựng lại request từ
// snapshot `before` (qua zod request schema của module), kiểm `restoreCheck`, dịch lỗi trùng tên / tham chiếu mất.
import type { AuditAction, AuditEntity } from "@ai/contracts";
import { commands, features, secrets, type Tx, workflows } from "@ai/db";
import { inArray } from "drizzle-orm";
import type { z } from "zod";
import { appError, isAppError } from "../../lib/errors";
import { validationError, zodIssues } from "../../lib/http";
import { restoreCheck } from "./audit.rules";

/** Hàng audit đang khôi phục (đã qua `canRestore`: snapshot đầy đủ, entity/action khôi phục được). */
export type RestoreEntry = {
  id: string;
  action: AuditAction;
  entityId: string;
  tenantId: string | null;
  entityVersion: number | null;
  before: Readonly<Record<string, unknown>>;
};
/** Version của thực thể sau khôi phục. */
export type Restored = { version: number };
export type RestoreMode = "update" | "insert";

/**
 * `restoreCheck` → ném `NOT_RESTORABLE`; còn lại trả cách ghi. `VERSION_CONFLICT` vẫn trả "update": lõi PATCH kiểm lại
 * version dưới khoá (`entry.entity_version`) và ném 409 kèm `current` đúng DTO của module.
 */
export function restoreMode(
  e: RestoreEntry,
  cur: { exists: boolean; version: number | null },
): RestoreMode {
  if (restoreCheck(e, cur) === "NOT_RESTORABLE") throw appError("NOT_RESTORABLE");
  return e.action === "delete" ? "insert" : "update";
}

/** Version gửi cho lõi PATCH: version của bản sau thay đổi được khôi phục (chỉ khôi phục thay đổi mới nhất). */
export function expectVersion(e: RestoreEntry): number {
  if (e.entityVersion === null) throw appError("NOT_RESTORABLE");
  return e.entityVersion;
}

/** Version khi chèn lại bản đã xoá: bản cuối + 1. */
export function reinsertVersion(e: RestoreEntry): number {
  const v = e.before.version;
  if (typeof v !== "number" || !Number.isInteger(v)) throw appError("NOT_RESTORABLE");
  return v + 1;
}

/** Lấy các khoá có trong snapshot (khoá vắng = để schema/lõi tự xử như request thật). */
export function pick(src: Readonly<Record<string, unknown>>, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in src) out[k] = src[k];
  return out;
}

/** Snapshot chạy lại zod request schema của module; không còn hợp lệ → 400 VALIDATION_ERROR như request thật. */
export function parseSnapshot<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const r = schema.safeParse(raw);
  if (!r.success) throw validationError(zodIssues(r.error));
  return r.data;
}

/** FK bắt buộc đã mất → 409 RESTORE_REF_MISSING. */
export function failRefMissing(missing: { entity: AuditEntity; id: string }[]): void {
  if (missing.length > 0) throw appError("RESTORE_REF_MISSING", { missing });
}

/** Lỗi trùng tên/khoá của module (`COMMAND_NAME_TAKEN`, `KEY_TAKEN`) → 409 NAME_TAKEN `{entity, name}`. */
export async function mapNameTaken<T>(
  entity: AuditEntity,
  key: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isAppError(err, "COMMAND_NAME_TAKEN")) {
      const name = (err.details as { name?: unknown } | undefined)?.name;
      throw appError("NAME_TAKEN", { entity, name: typeof name === "string" ? name : "" });
    }
    if (isAppError(err, "KEY_TAKEN")) throw appError("NAME_TAKEN", { entity, name: key ?? "" });
    throw err;
  }
}

const TABLES = { command: commands, feature: features, workflow: workflows, secret: secrets };

/** id còn tồn tại trong bảng (đọc không khoá; lõi module khoá/kiểm lại khi ghi). Không có id → tập rỗng. */
export async function existingIds(
  tx: Tx,
  entity: keyof typeof TABLES,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const t = TABLES[entity];
  const rows = await tx
    .select({ id: t.id })
    .from(t)
    .where(inArray(t.id, [...new Set(ids)]));
  return new Set(rows.map((r) => r.id));
}

/** Bỏ id đã mất khỏi tập (plan §4.4: `feature_ids`/`command_ids`), giữ thứ tự. */
export async function keepExisting(
  tx: Tx,
  entity: keyof typeof TABLES,
  ids: unknown,
): Promise<string[]> {
  if (!Array.isArray(ids)) return [];
  const want = ids.filter((x): x is string => typeof x === "string");
  const have = await existingIds(tx, entity, want);
  return want.filter((x) => have.has(x));
}
