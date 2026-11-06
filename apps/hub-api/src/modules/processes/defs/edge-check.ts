// CR-122 · N2 · FLOW2-FR-26 · kiểm tất định các cạnh của flow khi LƯU def: bước sau thiếu trường BẮT BUỘC ⇒ 422 `FLOW_EDGE_MISSING`
// (`details.edges`); lệch nhẹ (sai kiểu) ⇒ trả danh sách để gắn `warnings` vào response. Không có node bảng nào ⇒ không làm gì.
import {
  blockingEdgeIssues,
  type FlowEdgeIssue,
  flowEdgeIssues,
  type ProcessDef,
  type ProcessDefInput,
  type ProcessDefSaved,
} from "@ai/contracts/hub-admin";
import type { ProcessDeps } from "../core/ports";
import { defError } from "./defs.map";
import { paletteOf } from "./node-features";

export async function edgeCheck(
  d: { config?: ProcessDeps["config"] },
  tenantId: string | null,
  input: ProcessDefInput,
): Promise<FlowEdgeIssue[]> {
  if (!d.config || !input.stages.some((x) => x.node)) return [];
  const issues = flowEdgeIssues(input, await paletteOf(d.config, tenantId));
  const block = blockingEdgeIssues(issues);
  if (block.length > 0) throw defError("FLOW_EDGE_MISSING", { edges: block });
  return issues;
}

export const withWarnings = (def: ProcessDef, w: readonly FlowEdgeIssue[]): ProcessDefSaved =>
  w.length > 0 ? { ...def, warnings: [...w] } : def;
