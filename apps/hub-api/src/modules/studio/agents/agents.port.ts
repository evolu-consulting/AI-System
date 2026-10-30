// #226 · cổng của module `studio` (agents) cho module `kh` (CONVENTIONS §10): `kh.agent.service` không import
// `agents.repo` trực tiếp (depcruise `no-cross-module-repo`); đọc/khoá agent, id KH đã gắn và tăng version đi qua đây.
// dlc-dify · module `agent-hooks` đọc/thay hook và đọc workflow catalog cũng qua cổng này.
import type { Tx } from "@ai/db";
import {
  type AgentDbRow,
  bumpAgentVersion as bump,
  agentHooks as hooks,
  agentKhIds as khIds,
  readAgent as read,
  replaceAgentHooks as replaceHooks,
  type WorkflowDbRow,
  workflowsByIds as workflows,
} from "./agents.repo";

export type { AgentDbRow, WorkflowDbRow };

export function readAgent(tx: Tx, id: string, forUpdate = false): Promise<AgentDbRow | undefined> {
  return read(tx, id, forUpdate);
}

export function agentKhIds(tx: Tx, agentId: string): Promise<string[]> {
  return khIds(tx, agentId);
}

export function bumpAgentVersion(tx: Tx, id: string): Promise<AgentDbRow> {
  return bump(tx, id);
}

export function agentHooks(
  tx: Tx,
  agentId: string,
): Promise<{ event: string; workflow_id: string }[]> {
  return hooks(tx, agentId);
}

export function replaceAgentHooks(
  tx: Tx,
  agentId: string,
  list: readonly { event: string; workflow_id: string }[],
): Promise<void> {
  return replaceHooks(tx, agentId, list);
}

export function workflowsByIds(tx: Tx, ids: readonly string[]): Promise<WorkflowDbRow[]> {
  return workflows(tx, ids);
}
