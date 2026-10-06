// HUB-FR-60 · HUB-FR-61 · HUB-FR-64 · HUB-FR-69 · H4a-R03, R04, R05, R08, R09, R11 · plan §5.2 · nghiệp vụ agent Studio.
// Ghi qua `withConfigWrite` (khoá `config_meta` trước — plan §7 ⇒ `KEY_TAKEN` không race; 23505 chỉ là lưới thứ hai).
// Đọc: một transaction REPEATABLE READ read only scope `system` (P6).
import type {
  Agent,
  AgentCreate,
  AgentList,
  AgentRuntime,
  AgentWriteResponse,
} from "@ai/contracts/studio";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { readHubVersion } from "../studio-read.repo";
import { type StudioWriteDeps, withConfigWrite } from "../studio-write";
import { auditSnapshot, changedFields, toAgent, toListItem, toWorkflowRef } from "./agents.map";
import {
  type AgentDbRow,
  type AgentListFilter,
  agentWorkflowIds,
  enabledDescriptions,
  findAgentByKey,
  findAgentType,
  insertAgent,
  insertAgentWorkflows,
  listAgents,
  orchScopes,
  profileExists,
  readAgent,
  type WorkflowDbRow,
  workflowIdByKey,
  workflowsByIds,
} from "./agents.repo";
import {
  cliTools,
  difyOptions,
  needsBashAck,
  similarAgents,
  workflowProblem,
} from "./agents.rules";

const DIFY: ReadonlySet<AgentRuntime> = new Set(["dify-workflow", "dify-agent"]);

/** Trường tham chiếu chung create/update (PUT B5 dùng lại). */
export type AgentRefs = {
  runtime: AgentRuntime;
  profile_id?: string | null;
  agent_type_key?: string | null;
  workflow_ids: string[];
};

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** python: agent_type phải có, `available`, cùng runtime (plan §5.2 · QB7). */
async function checkAgentType(tx: Tx, key: string): Promise<void> {
  const t = await findAgentType(tx, key);
  let reason: "not_found" | "unavailable" | "runtime_mismatch" | null = null;
  if (!t) reason = "not_found";
  else if (!t.available) reason = "unavailable";
  else if (t.runtime !== "python") reason = "runtime_mismatch";
  if (reason) throw appError("INVALID_REFERENCE", { field: "agent_type_key", reason });
}

/** plan §5.2: profile → agent_type (python) → workflow. Trả workflow đã kiểm (để đặt `workflow_key` dify-*). */
export async function checkRefs(tx: Tx, b: AgentRefs): Promise<WorkflowDbRow[]> {
  if (b.profile_id && !(await profileExists(tx, b.profile_id)))
    throw appError("INVALID_REFERENCE", { field: "profile_id", reason: "not_found" });
  if (b.runtime === "python" && b.agent_type_key) await checkAgentType(tx, b.agent_type_key);
  const wfs = await workflowsByIds(tx, b.workflow_ids);
  const p = workflowProblem(b.runtime, wfs.map(toWorkflowRef), b.workflow_ids);
  if (p) throw appError("INVALID_REFERENCE", { field: "workflow_ids", ...p });
  return wfs;
}

/** Runtime H2a đọc `workflow_key` của dify-*: server đặt từ workflow đã kiểm (QB3/P11). */
export function runtimeOptionsOf(
  runtime: AgentRuntime,
  given: Record<string, unknown> | undefined,
  wfs: readonly WorkflowDbRow[],
): Record<string, unknown> {
  const wf = wfs[0];
  const dify = wf ? difyOptions(runtime, wf) : null;
  return dify ?? given ?? {};
}

export class AgentsService {
  constructor(private readonly d: StudioWriteDeps) {}

  #read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.d.db, { kind: "system" }, fn, {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  }

  /** P11: `workflow_ids` từ `agent_workflows`; agent dify-* seed cũ chưa có dòng ⇒ suy từ `workflow_key`. */
  async #detail(tx: Tx, row: AgentDbRow): Promise<Agent> {
    let ids = await agentWorkflowIds(tx, row.id);
    const wk = row.runtimeOptions.workflow_key;
    if (ids.length === 0 && DIFY.has(row.runtime as AgentRuntime) && typeof wk === "string") {
      const id = await workflowIdByKey(tx, wk);
      if (id) ids = [id];
    }
    const others = await enabledDescriptions(tx);
    return toAgent({
      row,
      workflowIds: ids,
      workflows: await workflowsByIds(tx, ids),
      scopes: await orchScopes(tx, row.id),
      similar: similarAgents(row, others),
    });
  }

  /** POST · 201 · KEY_TAKEN → tham chiếu → Bash ack (R05) → INSERT agent + agent_workflows → audit `create`. */
  async create(actor: AuthUser, b: AgentCreate): Promise<AgentWriteResponse> {
    const { result, version } = await withConfigWrite(this.d, actor, async (tx) => {
      if (await findAgentByKey(tx, b.key)) throw appError("KEY_TAKEN", { field: "key" });
      const wfs = await checkRefs(tx, b);
      const tools = b.runtime === "agentic-cli" ? cliTools(b.runtime_options) : [];
      const bashAck = needsBashAck(null, tools);
      if (bashAck && b.bash_ack !== true) throw appError("BASH_ACK_REQUIRED");
      const row = await insertAgent(tx, {
        key: b.key,
        name: b.name,
        description: b.description,
        runtime: b.runtime,
        agentTypeKey: b.agent_type_key ?? null,
        profileId: DIFY.has(b.runtime) ? null : (b.profile_id ?? null),
        systemPrompt: b.system_prompt,
        runtimeOptions: runtimeOptionsOf(b.runtime, b.runtime_options, wfs),
        timeoutS: b.timeout_s,
        tokenBudget: b.token_budget,
        enabled: b.enabled,
      }).catch((err: unknown) => {
        throw isUniqueViolation(err) ? appError("KEY_TAKEN", { field: "key" }) : err;
      });
      await insertAgentWorkflows(tx, row.id, b.workflow_ids, actor.userId);
      const agent = await this.#detail(tx, row);
      const after = auditSnapshot(agent);
      return {
        result: agent,
        audit: {
          tenantId: null,
          action: "create",
          entity: "agent",
          entityId: row.id,
          entityName: row.key,
          before: null,
          after,
          summary: { fields: changedFields(null, after), ...(bashAck && { bash_ack: true }) },
        },
      };
    });
    return { agent: result, hub_config_version: version };
  }

  /** GET :id · 404 khi không có. */
  get(id: string): Promise<Agent> {
    return this.#read(async (tx) => {
      const row = await readAgent(tx, id);
      if (!row) throw appError("NOT_FOUND");
      return this.#detail(tx, row);
    });
  }

  /** GET list · R11 · `truncated = offset + items < total`. */
  list(f: AgentListFilter): Promise<AgentList> {
    return this.#read(async (tx) => {
      const { rows, total } = await listAgents(tx, f);
      return {
        items: rows.map(toListItem),
        total,
        truncated: f.offset + rows.length < total,
        hub_config_version: await readHubVersion(tx),
      };
    });
  }
}
