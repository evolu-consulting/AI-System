// ADM-FR-51, ADM-FR-41 · câu mô tả một dòng nhật ký ("admin đã sửa command /dich"); hàm thuần dùng chung Tổng quan + Nhật ký (plan-frontend D13).
import type { AuditItem } from "@ai/contracts";
import type { Translate } from "./format";

/** `user_totp` → key `twofa`; còn lại key trùng giá trị. */
export function entityKey(entity: AuditItem["entity"]): string {
  return entity === "user_totp" ? "twofa" : entity;
}

type Parts = Record<string, string | number>;
type Picked = { key: string; params: Parts };

function totpKey(item: AuditItem): string {
  if (item.action === "create") return "totpOn";
  if (item.action === "update") return "totpRegen";
  const self = item.entity_id !== null && item.entity_id === item.actor_id;
  return self ? "totpOffSelf" : "totpOff";
}

/** Khoá câu cho các trường hợp đặc biệt theo (entity, action); không khớp → `null`. */
function specialKey(item: AuditItem): string | null {
  if (item.action === "import" || item.action === "restore") return item.action;
  if (item.entity === "user_totp") return totpKey(item);
  if (item.entity === "secret" && item.action === "update") return "secret";
  if (item.entity === "quota" || item.entity === "entitlement") return item.entity;
  if (item.action === "grant" || item.action === "revoke") return item.action;
  return null;
}

function summaryKey(s: AuditItem["summary"]): string | null {
  if (s.added || s.removed) return "members";
  return s.password_reset ? "passwordReset" : null;
}

function pick(item: AuditItem): Picked {
  const s = item.summary;
  const name = item.entity_name;
  const params: Parts = {
    name,
    subject: s.subject_name ?? name,
    feature: s.feature_key ?? name,
    file: name,
    a: s.added_count ?? s.added?.length ?? 0,
    u: s.updated_count ?? 0,
    r: s.removed?.length ?? 0,
    n: s.restored_version ?? item.entity_version ?? 0,
  };
  return { key: specialKey(item) ?? summaryKey(s) ?? item.action, params };
}

export function auditSentence(item: AuditItem, t: Translate): string {
  const actor = item.actor_username ?? t("audit.sentence.system");
  const { key, params } = pick(item);
  const entityType = t(`audit.entity.${entityKey(item.entity)}`);
  return t(`audit.sentence.${key}`, { actor, entityType, ...params });
}
