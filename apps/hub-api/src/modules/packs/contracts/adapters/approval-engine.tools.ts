// contract-flow S3a · tool gói của duyệt HĐ trên engine (stage `tool`, danh tính = người bắt đầu run, tx gói của tenant run).
// `side_effect: false` (S2: `finalize` biên dịch `real_action: false`; an toàn nằm ở kiểm lại trong `contracts-finalize`). Chỉ chạm
// HĐ có `engine_run_id = ctx.processRunId`; `/mcp` (không run) ⇒ từ chối. Không log nội dung.
import type { PackToolDef } from "../../kit/application/pack-tools.ports";
import { type FinalizeDeps, finalizeRun, routeStep } from "../application/approval-engine.usecase";
import { FLOW_TOOL_KEYS, FROM_STEP_ARG } from "../domain/approval-flow.rules";

const CONTRACT = { name: "contract_id", type: "text", required: true, description: "Mã hợp đồng" };

export function approvalEngineTools(d: FinalizeDeps): PackToolDef[] {
  const base = { pack: "contracts", side_effect: false, action: "write" as const };
  return [
    {
      ...base,
      name: FLOW_TOOL_KEYS.route,
      description: "Chọn bước duyệt kế theo luồng công ty và giá trị hiện tại của hợp đồng.",
      params: [
        CONTRACT,
        { name: FROM_STEP_ARG, type: "number", required: true, description: "Bước hiện tại" },
      ],
      run: routeStep(d),
    },
    {
      ...base,
      name: FLOW_TOOL_KEYS.finalize,
      description: "Ghi hợp đồng Đã duyệt khi mọi bước bắt buộc đã Đạt.",
      params: [CONTRACT],
      run: finalizeRun(d),
    },
  ];
}
