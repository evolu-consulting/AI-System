// ADM-FR-51 · M4-R10 · dựng hàng audit (`auditOf`) và ghi audit cho transaction không bump `config_version`
// (`recordAudit`: users reset-password, 2FA). Plan M4 §4.1, plan-cd §4.4.
import type { AuditEntity } from "@ai/contracts";
import {
  type AuditActionValue,
  type AuditInput,
  type ConfigSink,
  insertAuditRows,
  type Tx,
} from "@ai/db";
import { auditSnapshot } from "./audit.rules";

type Dto = Readonly<Record<string, unknown>>;

/** `AuditInput` + người thực hiện (NULL = hệ thống). */
export type AuditEntry = AuditInput & { actorId: string | null };

export type AuditOfInput = {
  entityId: string | null;
  entityName: string;
  tenantId: string | null;
  /** DTO đầy đủ (snake_case); lọc qua allowlist ở đây. null = không có (create: before, delete: after). */
  before: Dto | null;
  after: Dto | null;
  entityVersion?: number | null;
  summary?: Dto;
  snapshot?: boolean;
};

/** Hàng audit với `before/after` đã qua `auditSnapshot` — điểm gọi không bao giờ đưa DTO thô vào audit. */
export function auditOf(
  action: AuditActionValue,
  entity: AuditEntity,
  x: AuditOfInput,
): AuditInput {
  return {
    action,
    entity,
    entityId: x.entityId,
    entityName: x.entityName,
    tenantId: x.tenantId,
    before: x.before ? auditSnapshot(entity, x.before) : null,
    after: x.after ? auditSnapshot(entity, x.after) : null,
    entityVersion: x.entityVersion ?? null,
    summary: x.summary,
    snapshot: x.snapshot,
  };
}

/** Câu CUỐI của transaction không bump (khoá hạng 15, không chờ gì); `config_version` = NULL. */
export async function recordAudit(tx: Tx, e: AuditEntry): Promise<void> {
  const { actorId, ...row } = e;
  await insertAuditRows(tx, [row], { actorId, v: null });
}

/** Khôi phục bản đã xoá (plan M4 §4.4): chèn lại cùng `id`, `version` = bản cuối + 1. */
export type RestoreAt = { id: string; version: number };

/** Lõi tx của thao tác ghi cấu hình (callback `configWrite`), để khôi phục chạy lại trong một transaction. */
export type InTx = { tx: Tx; ch: ConfigSink };
