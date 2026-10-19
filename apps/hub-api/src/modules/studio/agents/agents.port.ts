// #226 · cổng của module `studio` (agents) cho module `kh` (CONVENTIONS §10): `kh.agent.service` không import
// `agents.repo` trực tiếp (depcruise `no-cross-module-repo`); đọc/khoá agent, id KH đã gắn và tăng version đi qua đây.
import type { Tx } from "@ai/db";
import {
  type AgentDbRow,
  bumpAgentVersion as bump,
  agentKhIds as khIds,
  readAgent as read,
} from "./agents.repo";

export type { AgentDbRow };

export function readAgent(tx: Tx, id: string, forUpdate = false): Promise<AgentDbRow | undefined> {
  return read(tx, id, forUpdate);
}

export function agentKhIds(tx: Tx, agentId: string): Promise<string[]> {
  return khIds(tx, agentId);
}

export function bumpAgentVersion(tx: Tx, id: string): Promise<AgentDbRow> {
  return bump(tx, id);
}
