// CR-103 · R1 · node `agent`: một agent chạy stage qua `hub.runs` (HUB-FR-105). Phần thuần (kiểm def, cờ năng lực).
import { NODE_FAMILY_OF } from "@ai/contracts/hub-admin";
import type { NodeSpec } from "../types";

export const agentNode: NodeSpec<"agent"> = {
  kind: "agent",
  family: NODE_FAMILY_OF.agent,
  produces: "declared",
  // D4 · HUB-BR-38(b) · stage agent `real_action` chèn xác nhận workflow side_effect.
  realAction: true,
  // HUB-FR-136 · R10 · chỉ stage agent có mục "Bàn giao".
  handoff: true,
  agentId(ex) {
    const id = (ex as { agent_id?: unknown }).agent_id;
    return typeof id === "string" ? id : null;
  },
  refMiss(ex, p, refs) {
    return refs.agentIds.has(ex.agent_id) ? null : { path: `${p}.executor.agent_id`, ref: "agent" };
  },
};
