// dlc-dify · `PUT /studio/api/agents/:id/hooks`: thay toàn bộ hook của agent (mỗi sự kiện ≤ 1 workflow Dify loại `workflow`).
// Một gói `withConfigWrite` như PUT knowledge: khoá agent (404 → version 409, `current` = Agent) → workflow phải có trong
// catalog Admin, loại app `workflow` (422 `INVALID_REFERENCE` field `hooks`) → thay `agent_hooks` → `agents.version + 1` →
// audit `update · agent`. Workflow tắt vẫn lưu được (lúc chạy bị bỏ qua) — giống workflow gắn agent.
import type { AgentHooksRequest, AgentWriteResponse } from "@ai/contracts/studio";
import type { Tx } from "@ai/db";
import type { AuthUser } from "../../lib/auth.middleware";
import { appError } from "../../lib/errors";
import { changedFields } from "../studio/agents/agents.map";
import {
  type AgentDbRow,
  agentHooks,
  bumpAgentVersion,
  readAgent,
  replaceAgentHooks,
  workflowsByIds,
} from "../studio/agents/agents.port";
import { agentDetail } from "../studio/agents/agents.service";
import { type StudioWriteDeps, withConfigWrite } from "../studio/studio-write";
import { HOOK_APP_TYPE } from "./hooks.rules";

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

/** Workflow của hook phải tồn tại và là app `workflow` (hook chạy blocking, cần `outputs`). */
async function assertWorkflows(tx: Tx, ids: readonly string[]): Promise<void> {
  const found = await workflowsByIds(tx, ids);
  const ok = new Set(found.filter((w) => w.appType === HOOK_APP_TYPE).map((w) => w.id));
  const bad = ids.filter((id) => !ok.has(id));
  if (bad.length > 0)
    throw appError("INVALID_REFERENCE", { field: "hooks", reason: "not_found", ids: bad });
}

type HookPair = { event: string; workflow_id: string };
const keyOf = (l: readonly HookPair[]) =>
  l
    .map((h) => `${h.event}=${h.workflow_id}`)
    .sort()
    .join("|");
export const sameHooks = (a: readonly HookPair[], b: readonly HookPair[]) => keyOf(a) === keyOf(b);

export class AgentHooksService {
  constructor(private readonly d: StudioWriteDeps) {}

  async setHooks(u: AuthUser, id: string, b: AgentHooksRequest): Promise<AgentWriteResponse> {
    const hooks = b.hooks.map((h) => ({
      event: h.event,
      workflow_id: h.workflow_id.toLowerCase(),
    }));
    const { result, version } = await withConfigWrite(this.d, u, async (tx) => {
      const row = await lockAgent(tx, id, b.version);
      await assertWorkflows(tx, [...new Set(hooks.map((h) => h.workflow_id))]);
      const before = await agentHooks(tx, id);
      // Không đổi gì ⇒ không ghi, không bump version, không audit (như PUT khác của Studio).
      if (sameHooks(before, hooks)) return { result: await agentDetail(tx, row), audit: null };
      await replaceAgentHooks(tx, id, hooks);
      const agent = await agentDetail(tx, await bumpAgentVersion(tx, id));
      const snap = (h: readonly unknown[], v: number) => ({ hooks: h, version: v });
      const a0 = snap(before, row.version);
      const a1 = snap(agent.hooks ?? [], agent.version);
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
