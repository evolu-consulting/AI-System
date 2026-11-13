// [AUDIT] · kiểu sự kiện việc trên task duyệt cho gói (lớp application — tách khỏi ports.ts, trần 400 dòng).
/** [AUDIT] · việc trên task duyệt (không phải quyết định). `key` idempotent (task × loại × lúc). */
export type PackTaskEventKind = "claim" | "release" | "reassign" | "auto_release" | "escalate";
export type PackTaskEventIn = {
  tenantId: string;
  taskId: string;
  kind: PackTaskEventKind;
  /** null = hệ thống (tự trả / chuyển cấp). */
  actor: string | null;
  /** người / Group nhận (giao lại · chuyển cấp). */
  to: string | null;
  reason: string | null;
  at: string;
};
