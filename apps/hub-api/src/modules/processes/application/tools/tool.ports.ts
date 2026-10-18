// HUB-FR-146 · AC-H44 · AC-H47 · D2-11 · plan-d2 §3: cổng lớp 2 của stage `tool` — CHỈ kiểu, không `Tx`. `TxRepos.tools`
// (`ports.ts`) = `ToolStageRepo` gắn tx + tenant của UoW (mọi câu lọc `tenant_id`, S9).
import type { ToolDefShape } from "../../domain/defs/tool-def.rules";
import type { RetryState } from "../../domain/runs/retry.rules";
import type { ToolFieldDecl } from "../../domain/tools/tool-output.rules";
import type { ArgSource, ToolArgValue } from "../../domain/tools/tool-run.rules";

export type ToolCallLoad = {
  stageName: string;
  toolKey: string;
  workflowId: string;
  sideEffect: boolean;
  /** M1/S4 · `real_action` của stage trong snapshot — `sideEffect ∧ ¬realAction` ⇒ `tool_failed` lúc chạy. */
  realAction: boolean;
  /** m1 · `admin.workflows.input_schema` qua `InputSchemaSchema` (như catalog `/mcp`); `false` ⇒ `tool_failed`. */
  inputSchemaOk: boolean;
  timeoutS: number;
  args: Readonly<Record<string, ArgSource>>;
  outputFields: readonly ToolFieldDecl[];
  inputs: ReadonlyMap<string, string>;
  inputTypes?: ReadonlyMap<string, string>;
  fields: ReadonlyMap<string, Readonly<Record<string, string | number>> | null>;
  startedBy: string;
  usable: boolean;
  canRun: boolean;
  switchOn: boolean;
  wfEnabled: boolean;
  state: RetryState;
  /** Đích gọi đọc từ `admin.workflows` CÙNG câu (S2/S3: tươi, không cache); vắng ⇒ adapter tra catalog Hub. */
  endpoint?: ToolEndpoint;
};
export type ToolEndpoint = {
  key: string;
  name: string;
  appType: string;
  baseUrl: string;
  outputField: string | null;
};
export type ToolDecisionReason =
  | "tool_failed"
  | "template_invalid"
  | "retry_exhausted"
  | "permission_lost"
  | "user_inactive";

export type ToolStageRepo = {
  /** MỘT câu: stage `running` của `hubRunId` + snapshot + inputs + fields nguồn + công tắc/enabled + usable/canRun. */
  loadCall(runId: string, stageRunId: string, hubRunId: string): Promise<ToolCallLoad | null>;
  /** PD2-R09 · MỘT câu audit `tool_call` (run, stage, tool_key, người bắt đầu, trạng thái, mã, ms) — KHÔNG giá trị. */
  audit(x: ToolCallAudit): Promise<void>;
  /**
   * Đã hẹn `retry` (stage `waiting_timer`): `process_updated` vào outbox, không kick/thread. Tuỳ chọn (mở rộng cổng plan-d2
   * §3 không phá cổng giả): vắng ⇒ không phát sự kiện sống (hẹn bắn sẽ phát khi requeue).
   */
  retried?(runId: string): Promise<void>;
  /** Sau `runs.lock`: `for update` stage còn `running ∧ current_run_id = hubRunId`; false ⇒ bỏ (đua). */
  lockRunning(stageRunId: string, hubRunId: string): Promise<boolean>;
  /** Output (.md + fields) rồi đường hậu-output như agent (D2-30); kick/thread/sự kiện vào outbox. */
  settleOk(
    x: {
      runId: string;
      stageRunId: string;
      hubRunId: string;
      md: string;
      fields: Record<string, string | number>;
    },
    now: Date,
  ): Promise<void>;
  /** needs_decision(reason) + task + thread (như `toDecision`); sự kiện vào outbox. */
  decide(
    x: { runId: string; stageRunId: string; reason: ToolDecisionReason },
    now: Date,
  ): Promise<void>;
};

export type ToolCallAudit = {
  runId: string;
  stageRunId: string;
  toolKey: string;
  startedBy: string;
  status: "ok" | "failed";
  code: string | null;
  ms: number;
};

/** `failed` = `ToolFailure` lớp 1 (`sent` từ kết quả gọi, D2-13; `reason` của client Dify). */
export type ToolCallResult =
  | { kind: "ok"; text: string }
  | {
      kind: "failed";
      code: string;
      httpStatus: number | null;
      sent: boolean;
      reason: string | null;
    };
/** Nối lớp 4 tới `WorkflowInvoker` (cùng pipeline `/mcp`: key → bước `tool` → Dify gom → usage). */
export type ToolInvoker = {
  call(c: {
    tenantId: string;
    userId: string;
    hubRunId: string;
    workflowId: string;
    endpoint?: ToolEndpoint;
    args: Record<string, ToolArgValue>;
    timeoutS: number;
    signal?: AbortSignal;
  }): Promise<ToolCallResult>;
};

/** Một tool của catalog editor (TT-R04): hình luật + tên/mô tả hiển thị. */
export type ToolCatalogItem = ToolDefShape & { name: string; description: string };
/** Tool khả dụng của tenant (TT-R04) — adapter gắn tx + tenant. `keys` vắng ⇒ tất cả (≤ 200). */
export type ToolSwitchReader = {
  available(keys?: readonly string[]): Promise<ToolCatalogItem[]>;
};
