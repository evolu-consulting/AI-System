// HUB-FR-132 · CR-073 · spec K1 §3.2 · plan §3.3 (Gắn agent), §4 · `PUT /studio/api/agents/:id/knowledge`: agent tick kết
// nối KH (thứ tự = thứ tự tick, ≤ 5, chỉ `agentic-cli`). Một gói `withConfigWrite`: khoá agent (404 → version 409, `current`
// = Agent) → `validateAgentKh` (runtime 422 · trùng/quá 400 path `connection_ids`) → id thiếu 422 → thay `agent_kh` →
// `agents.version + 1` → audit `update · agent`. Không đụng khoá/secret.
import type { AgentKnowledgeRequest } from "@ai/contracts/hub-admin";
import type { AgentWriteResponse } from "@ai/contracts/studio";
import type { Tx } from "@ai/db";
import type { AuthUser } from "../../lib/auth.middleware";
import { appError } from "../../lib/errors";
import { validationError } from "../../lib/http";
import { changedFields } from "../studio/agents/agents.map";
import {
  type AgentDbRow,
  agentKhIds,
  bumpAgentVersion,
  readAgent,
} from "../studio/agents/agents.port";
import { agentDetail } from "../studio/agents/agents.service";
import { type StudioWriteDeps, withConfigWrite } from "../studio/studio-write";
import { validateAgentKh } from "./kh.agent.rules";
import { khError } from "./kh.errors";
import * as repo from "./kh.repo";

async function lockAgent(tx: Tx, id: string, version: number): Promise<AgentDbRow> {
  const row = await readAgent(tx, id, true);
  if (!row) throw appError("NOT_FOUND");
  if (row.version !== version)
    throw appError("VERSION_CONFLICT", {
      current: await agentDetail(tx, row),
      updated_at: row.updatedAt,
    });
  return row;
}

/** Lỗi luật thuần ⇒ lỗi HTTP (trùng/quá: lưới sau zod — id khác hoa/thường vẫn là trùng). */
function assertRule(ids: readonly string[], runtime: string): void {
  const bad = validateAgentKh(ids, runtime);
  if (bad === "runtime") throw khError("KH_AGENT_RUNTIME");
  if (bad)
    throw validationError([
      { path: ["connection_ids"], code: "custom", message: `connection_ids: ${bad}` },
    ]);
}

export class KhAgentService {
  constructor(private readonly d: StudioWriteDeps) {}

  async setKnowledge(
    u: AuthUser,
    id: string,
    b: AgentKnowledgeRequest,
  ): Promise<AgentWriteResponse> {
    const ids = b.connection_ids.map((x) => x.toLowerCase());
    const { result, version } = await withConfigWrite(this.d, u, async (tx) => {
      const row = await lockAgent(tx, id, b.version);
      assertRule(ids, row.runtime);
      const found = await repo.existingConnIds(tx, ids);
      const missing = ids.filter((x) => !found.has(x));
      if (missing.length > 0) throw khError("KH_CONNECTION_NOT_FOUND", { ids: missing });
      const before = await agentKhIds(tx, id);
      await repo.replaceAgentKh(tx, id, ids);
      const agent = await agentDetail(tx, await bumpAgentVersion(tx, id));
      const snap = (k: readonly string[], v: number) => ({
        knowledge_connection_ids: k,
        version: v,
      });
      const a0 = snap(before, row.version);
      const a1 = snap(ids, agent.version);
      return {
        result: agent,
        audit: {
          tenantId: null,
          action: "update",
          entity: "agent",
          entityId: id,
          entityName: row.key,
          before: a0,
          after: a1,
          summary: { fields: changedFields(a0, a1) },
        },
      };
    });
    return { agent: result, hub_config_version: version };
  }
}
