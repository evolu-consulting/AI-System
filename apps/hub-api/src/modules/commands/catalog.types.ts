// HUB-FR-10, HUB-FR-12, HUB-FR-89 · kiểu catalog Admin trong cache Hub (plan H2a §4, plan-rules). Chỉ kiểu, không I/O.
import type {
  CommandArg,
  CommandOutput,
  InputMap,
  LocalizedText,
  WorkflowInput,
} from "@ai/contracts";
import type { DifyAppType, DifyFileInput } from "@ai/contracts/hub";

/** H2c P13 · `DifyFileInput` chỉ do driver điền sau upload (B7), không bao giờ từ tham số/MCP. */
export type WorkflowInputValue = string | number | boolean | DifyFileInput;

/** `admin.workflows` + `hub.workflow_flags` (cờ `side_effect` dự phòng, P14). */
export type CatalogWorkflow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  appType: DifyAppType;
  baseUrl: string;
  secretId: string | null;
  inputSchema: readonly WorkflowInput[];
  outputField: string | null;
  enabled: boolean;
  sideEffect: boolean;
};

/** `admin.commands` (+ `command_names` cho `aliases`). */
export type CatalogCommand = {
  id: string;
  name: string;
  aliases: readonly string[];
  description: LocalizedText;
  workflowId: string;
  args: readonly CommandArg[];
  inputMap: InputMap;
  output: CommandOutput;
  mode: "sync" | "async";
  timeoutS: number;
  enabled: boolean;
};

/** Đầu vào `buildWorkflowJobPayload` (runner.rules) — đã qua `prepare` (snapshot, R08). */
export type WorkflowJobInput = {
  jobId: string;
  runId: string;
  stepId: string;
  tenantId: string;
  userId: string;
  conversationId: string;
  flowId: string;
  featureId: string | null;
  commandId: string | null;
  workflow: CatalogWorkflow;
  inputs: Record<string, WorkflowInputValue>;
  query: string | null;
  outputField: string | null;
  difyUser: string;
  timeoutS: number;
};
