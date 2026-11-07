// CR-122 · N2 · FLOW2-FR-26 · kiểm tất định các cạnh của flow khi LƯU def: bước sau thiếu trường BẮT BUỘC ⇒ 422 `FLOW_EDGE_MISSING`
// (`details.edges`); lệch nhẹ (sai kiểu) ⇒ trả danh sách để gắn `warnings` vào response. Không có node bảng nào ⇒ không làm gì.
import {
  blockingEdgeIssues,
  clusterIssueMessage,
  FLOW_NODE_SPLIT_ERROR,
  type FlowEdgeIssue,
  flowEdgeIssues,
  moduleClusterIssues,
  type ProcessDef,
  type ProcessDefInput,
  type ProcessDefSaved,
} from "@ai/contracts/hub-admin";
import { AppError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { defError } from "./defs.map";
import { paletteOf } from "./node-features";

export async function edgeCheck(
  d: { config?: ProcessDeps["config"] },
  tenantId: string | null,
  input: ProcessDefInput,
): Promise<FlowEdgeIssue[]> {
  clusterCheck(input); // CR-123 · u3a · FR-14: cụm node module trước (thuần, 0 SQL)
  if (!d.config || !input.stages.some((x) => x.node)) return [];
  const issues = flowEdgeIssues(input, await paletteOf(d.config, tenantId));
  const block = blockingEdgeIssues(issues);
  if (block.length > 0) throw defError("FLOW_EDGE_MISSING", { edges: block });
  return issues;
}

/**
 * CR-123 · u3a · FR-14 · node module nhiều stage (Ký số = gửi + chờ) phải là MỘT cụm liên tiếp, đủ, đúng thứ tự ⇒ không thì 422
 * `FLOW_NODE_SPLIT` (message nói tên bước + cách sửa). Thuần, O(số stage), 0 SQL — chạy trước mọi kiểm cần DB.
 */
export function clusterCheck(input: Pick<ProcessDefInput, "stages">): void {
  const issues = moduleClusterIssues(
    input.stages.map((s) => ({ node: s.node, executor: s.executor })),
  );
  const first = issues[0];
  if (!first) return;
  const { code, status } = FLOW_NODE_SPLIT_ERROR;
  throw new AppError(code, status, clusterIssueMessage(first), { nodes: issues });
}

export const withWarnings = (def: ProcessDef, w: readonly FlowEdgeIssue[]): ProcessDefSaved =>
  w.length > 0 ? { ...def, warnings: [...w] } : def;
