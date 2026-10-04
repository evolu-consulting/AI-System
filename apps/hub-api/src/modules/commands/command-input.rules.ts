// HUB-FR-12 · H2a-R06 · dựng `inputs` Dify từ `input_map` + kiểm kiểu (plan-rules). Thuần.
// B0: chỉ chữ ký — thân làm ở B3.
import type { CommandArg, InputMap, WorkflowInput } from "@ai/contracts";
import type { MessageContext } from "@ai/contracts/chat";
import type { DifyAppType } from "@ai/contracts/hub";
import type { WorkflowInputValue } from "./catalog.types";

export type BuildInputsInput = {
  inputMap: InputMap;
  inputSchema: readonly WorkflowInput[];
  args: readonly CommandArg[];
  values: Record<string, string | null>;
  ctx: MessageContext;
  userId: string;
  tenantId: string;
};

export type BuildInputsResult =
  | { ok: true; inputs: Record<string, WorkflowInputValue>; query: string | null }
  | { ok: false; missing: string[]; invalid: string[] };

/** number = `Number()` hữu hạn; boolean ∈ {true,false,1,0,yes,no} (không phân biệt hoa); select ∉ options → invalid. */
export function buildInputs(i: BuildInputsInput): BuildInputsResult {
  throw new Error(`not implemented: buildInputs(${i.inputSchema.length})`);
}

/** `chat`/`agent` cần `query`; `workflow` không. */
export function appNeedsQuery(appType: DifyAppType): boolean {
  throw new Error(`not implemented: appNeedsQuery(${appType})`);
}
