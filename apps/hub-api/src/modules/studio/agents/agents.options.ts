// dlc-agent-flows · `runtime_options` agentic-cli khi lưu agent: (1) client cũ (Agent Forge trước bản này) gửi options KHÔNG có
// `pack_tools`/`dlc_flows`/`persona_project` ⇒ giữ giá trị đang lưu (vắng = không sửa; `[]`/`{}` = xoá) — trước đây PUT làm mất
// `pack_tools` của dlc-agent; (2) `dlc_flows` phải trỏ def thư viện ĐÃ xuất bản của đúng khe DLC.
import { type AgentRuntime, DlcFlowsSchema } from "@ai/contracts/studio";
import type { Tx } from "@ai/db";
import { appError } from "../../../lib/errors";
import { DLC_FLOW_SLOTS, dlcFlowProblems } from "../dlc-flows/dlc-flows.map";
import { publishedSlotDefs } from "../dlc-flows/dlc-flows.repo";

/** Khoá options agentic-cli mà form cũ không biết (seed/DB đặt) — vắng trong body ⇒ giữ bản đang lưu. */
export const CLI_KEPT_KEYS = ["pack_tools", "dlc_flows", "persona_project"] as const;

export function keepCliExtras(
  runtime: AgentRuntime,
  given: Record<string, unknown> | undefined,
  current: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (runtime !== "agentic-cli" || !given) return given;
  const kept = CLI_KEPT_KEYS.filter((k) => !(k in given) && current[k] !== undefined);
  return kept.length === 0
    ? given
    : { ...given, ...Object.fromEntries(kept.map((k) => [k, current[k]])) };
}

/** `dlc_flows` (nếu có) chỉ chứa def thư viện đã xuất bản của khe tương ứng; sai ⇒ 400 `INVALID_REFERENCE`. */
export async function checkDlcFlows(tx: Tx, opts: Record<string, unknown>): Promise<void> {
  if (opts.dlc_flows === undefined) return;
  const r = DlcFlowsSchema.safeParse(opts.dlc_flows);
  if (r.success && Object.keys(r.data).length === 0) return;
  const bad = r.success
    ? dlcFlowProblems(r.data, await publishedSlotDefs(tx, DLC_FLOW_SLOTS))
    : ["dlc_flows"];
  if (bad.length > 0)
    throw appError("INVALID_REFERENCE", {
      field: "runtime_options.dlc_flows",
      reason: "not_found",
      keys: bad,
    });
}
