// ADM-FR-52 · M4-AC08 · M4-R13 · câu của luồng "Khôi phục bản trước": tiêu đề xác nhận và lỗi 409/400 → key i18n (plan-frontend §3.4, §8).
import type { AuditEntity, AuditItem } from "@ai/contracts";
import { entityKey } from "@/lib/audit-sentence";
import type { MessageSpec } from "@/lib/errors";
import type { Translate } from "@/lib/format";
import { ApiError } from "@/lib/http";

/** Command hiển thị kèm `/` (ms §7.2: "/dich"); server có thể trả tên thô (`dich`) trong `details.name`. */
export function displayName(entity: AuditEntity, name: string): string {
  return entity === "command" && name !== "" && !name.startsWith("/") ? `/${name}` : name;
}

/** Tham số cho `audit.restore.title` / `.body`: "trước v{n}" = `entity_version`; bản mới = n + 1. */
export function restoreParams(item: AuditItem): { name: string; n: number; next: number } {
  const n = item.entity_version ?? 0;
  return { name: displayName(item.entity, item.entity_name), n, next: n + 1 };
}

const CODE_KEYS: Record<string, string> = {
  VERSION_CONFLICT: "audit.error.changedSince",
  NOT_RESTORABLE: "audit.error.notRestorable",
  RESTORE_REF_MISSING: "audit.error.refMissing",
  VALIDATION_ERROR: "audit.error.invalid",
};

function detailName(details: unknown): string | null {
  const v = (details as { name?: unknown } | null | undefined)?.name;
  return typeof v === "string" && v !== "" ? v : null;
}

/** Lỗi khôi phục → câu; `null` = để `describeError` chung xử lý (403, mạng, 5xx…). */
export function restoreErrorSpec(err: unknown, item: AuditItem, t: Translate): MessageSpec | null {
  if (!(err instanceof ApiError)) return null;
  const name = displayName(item.entity, item.entity_name);
  if (err.code === "NAME_TAKEN") {
    const taken = displayName(item.entity, detailName(err.details) ?? item.entity_name);
    return {
      key: "audit.error.nameTaken",
      params: { name: taken, entityType: t(`audit.entity.${entityKey(item.entity)}`) },
    };
  }
  const key = CODE_KEYS[err.code];
  return key ? { key, params: { name } } : null;
}
