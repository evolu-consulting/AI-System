// Rule thuan "stage chay bang dung mot agent" (arch-a7: la chung cho kh/processes, khong import module).
// Nguon la loai node `agent` (processes/nodes/agent/node.ts `agentId`); test registry giu hai ben khop nhau.

/** Hinh toi thieu cua stage cho luat them muc (`ensureHandoff`; K1 `khStartPlan` them "Tom tat"). */
export type HandoffShape = {
  executor: { kind: string };
  output: { required_sections: string[]; template: string };
};

/** Loai node chay bang dung mot agent (khong can doc agent_id). */
export const runsAsAgent = (kind: string): boolean => kind === "agent";

/** agent_id khi stage chay bang dung mot agent; con lai null. */
export const agentIdOf = (ex: { kind: string }): string | null => {
  if (!runsAsAgent(ex.kind)) return null;
  const id = (ex as { agent_id?: unknown }).agent_id;
  return typeof id === "string" ? id : null;
};
