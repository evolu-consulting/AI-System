// ADM-FR-73 · lớp 2: cổng của module workflow-tools (plan-d2 §6). Không import @ai/db/@ai/contracts (ADR-0023).

/** Một workflow catalog kèm công tắc của tenant (view trả ra API). */
export type ToolView = {
  workflowId: string;
  key: string;
  name: string;
  sideEffect: boolean;
  enabled: boolean;
  on: boolean;
  grantedAt: Date | null;
  grantedBy: string | null;
};

/** Hàng công tắc hiện có (đã khoá FOR UPDATE) — vắng ⇒ chưa từng bật. */
export type SwitchRow = { revokedAt: Date | null; grantedAt: Date; grantedBy: string | null };

/** Workflow đích của một lần bật/tắt + hàng công tắc đã khoá. */
export type ToolTarget = {
  workflowId: string;
  key: string;
  name: string;
  sideEffect: boolean;
  enabled: boolean;
  cur: SwitchRow | null;
};

export type SwitchKey = { tenantId: string; workflowId: string };

export interface WorkflowToolsRepo {
  tenantExists(tenantId: string): Promise<boolean>;
  /** Mọi workflow catalog sắp `key`, ≤ `limit`, kèm công tắc của tenant — một câu. */
  list(tenantId: string, limit: number): Promise<ToolView[]>;
  /** Tenant + workflow tồn tại ⇒ workflow + hàng công tắc (FOR UPDATE); vắng một trong hai ⇒ null. Một câu. */
  lockOne(k: SwitchKey): Promise<ToolTarget | null>;
  /** Trả hàng sau ghi; null ⇒ không đổi hàng (đua: hàng đã được người khác ghi). */
  insert(k: SwitchKey, actorId: string): Promise<SwitchRow | null>;
  reactivate(k: SwitchKey, actorId: string): Promise<SwitchRow | null>;
  revoke(k: SwitchKey): Promise<SwitchRow | null>;
}

/** Audit `entity:"workflow"`, `action` grant/revoke, before/after `{on}` (TT-R03). */
export type ToolAudit = {
  action: "grant" | "revoke";
  tenantId: string;
  workflowId: string;
  key: string;
};

/** `changed` ⇒ `config_changed {entity:"workflow", tenantId}`; `audit` cùng transaction (configWrite). */
export type ToolSink = { changed(tenantId: string): void; audit(a: ToolAudit): void };

export interface ToolsTx {
  read<T>(fn: (r: WorkflowToolsRepo) => Promise<T>): Promise<T>;
  write<T>(fn: (r: WorkflowToolsRepo, sink: ToolSink) => Promise<T>): Promise<T>;
}

/** Tenant hoặc workflow không tồn tại ⇒ adapter đổi thành 404 `NOT_FOUND`. */
export class ToolNotFoundError extends Error {
  constructor() {
    super("workflow-tools: tenant hoặc workflow không tồn tại");
    this.name = "ToolNotFoundError";
  }
}
