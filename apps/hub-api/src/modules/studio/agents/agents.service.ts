// HUB-FR-60 · HUB-FR-61 · HUB-FR-64 · HUB-FR-69 · H4a-R03…R06, R08, R09, R11 · plan §5.2 · nghiệp vụ agent Studio.
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
  agentAccessCounts,
  agentHasHistory,
  agentWorkflowIds,
  deleteAgent,
  deleteAgentWorkflowsExcept,
  enabledDescriptions,
  findAgentByKey,
  findAgentType,
  insertAgent,
  insertAgentWorkflows,
  listAgents,
  type OrchScope,
  orchScopes,
  profileExists,
  readAgent,
  setAgentEnabled,
  updateAgent,
  type WorkflowDbRow,
  workflowIdByKey,
  workflowsByIds,
} from "./agents.repo";
import {
  cliTools,
  deleteBlocker,
  difyOptions,
  disableBlocked,
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

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Body PUT đã parse bằng `agentUpdateSchemaFor(runtime của hàng DB)` — không `key`/`runtime` (QB5). */
export type AgentUpdateBody = DistOmit<AgentCreate, "key" | "runtime"> & { version: number };

/** `details.scopes` của `AGENT_IN_USE_AS_ORCHESTRATOR` (plan §2.1). */
function inUseError(scopes: readonly OrchScope[]) {
  return appError("AGENT_IN_USE_AS_ORCHESTRATOR", {
    scopes: scopes.map((s) =>
      s.tenantId === null
        ? { tenant_id: null }
        : { tenant_id: s.tenantId, tenant_key: s.tenantKey },
    ),
  });
}

/** `allowed_tools` chỉ có nghĩa với agentic-cli (R05). */
const toolsOf = (runtime: AgentRuntime, opts: Record<string, unknown> | undefined): string[] =>
  runtime === "agentic-cli" && opts ? cliTools(opts) : [];

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

  /** `AGENT_FOR_UPDATE` (vắng ⇒ 404) → version lệch ⇒ `VERSION_CONFLICT{current, updated_at}` (đi trước mọi chặn). */
  async #lockAgent(tx: Tx, id: string, version: number): Promise<AgentDbRow> {
    const row = await readAgent(tx, id, true);
    if (!row) throw appError("NOT_FOUND");
    if (row.version !== version)
      throw appError("VERSION_CONFLICT", {
        current: await this.#detail(tx, row),
        updated_at: row.updatedAt,
      });
    return row;
  }

  /** Runtime của hàng (route chọn nhánh `agentUpdateSchemaFor`) · 404 khi không có. */
  runtimeOf(id: string): Promise<AgentRuntime> {
    return this.#read(async (tx) => {
      const row = await readAgent(tx, id);
      if (!row) throw appError("NOT_FOUND");
      return row.runtime as AgentRuntime;
    });
  }

  /** PUT · 200 · version → chặn tắt Orchestrator → tham chiếu → Bash ack (chỉ thêm mới) → UPDATE → đồng bộ workflow. */
  async update(actor: AuthUser, id: string, b: AgentUpdateBody): Promise<AgentWriteResponse> {
    const { result, version } = await withConfigWrite(this.d, actor, async (tx) => {
      const row = await this.#lockAgent(tx, id, b.version);
      const runtime = row.runtime as AgentRuntime;
      const scopes = await orchScopes(tx, id);
      if (disableBlocked(scopes.length, b.enabled)) throw inUseError(scopes);
      const wfs = await checkRefs(tx, { ...b, runtime });
      const given = b.runtime_options as Record<string, unknown> | undefined;
      const bashAck = needsBashAck(toolsOf(runtime, row.runtimeOptions), toolsOf(runtime, given));
      if (bashAck && b.bash_ack !== true) throw appError("BASH_ACK_REQUIRED");
      const before = auditSnapshot(await this.#detail(tx, row));
      const next = await updateAgent(tx, id, {
        name: b.name,
        description: b.description,
        agentTypeKey: b.agent_type_key ?? null,
        profileId: DIFY.has(runtime) ? null : (b.profile_id ?? null),
        systemPrompt: b.system_prompt,
        runtimeOptions: runtimeOptionsOf(runtime, given, wfs),
        timeoutS: b.timeout_s,
        tokenBudget: b.token_budget,
        enabled: b.enabled,
      });
      await deleteAgentWorkflowsExcept(tx, id, b.workflow_ids);
      await insertAgentWorkflows(tx, id, b.workflow_ids, actor.userId);
      const agent = await this.#detail(tx, next);
      const after = auditSnapshot(agent);
      return {
        result: agent,
        audit: {
          tenantId: null,
          action: "update",
          entity: "agent",
          entityId: id,
          entityName: next.key,
          before,
          after,
          summary: { fields: changedFields(before, after), ...(bashAck && { bash_ack: true }) },
        },
      };
    });
    return { agent: result, hub_config_version: version };
  }

  /** PATCH enabled · 200 · version → (tắt) chặn Orchestrator → UPDATE → audit `enable`/`disable`. */
  async setEnabled(
    actor: AuthUser,
    id: string,
    b: { enabled: boolean; version: number },
  ): Promise<AgentWriteResponse> {
    const { result, version } = await withConfigWrite(this.d, actor, async (tx) => {
      const row = await this.#lockAgent(tx, id, b.version);
      const scopes = b.enabled ? [] : await orchScopes(tx, id);
      if (disableBlocked(scopes.length, b.enabled)) throw inUseError(scopes);
      const before = auditSnapshot(await this.#detail(tx, row));
      const agent = await this.#detail(tx, await setAgentEnabled(tx, id, b.enabled));
      const after = auditSnapshot(agent);
      return {
        result: agent,
        audit: {
          tenantId: null,
          action: b.enabled ? "enable" : "disable",
          entity: "agent",
          entityId: id,
          entityName: row.key,
          before,
          after,
          summary: { fields: changedFields(before, after) },
        },
      };
    });
    return { agent: result, hub_config_version: version };
  }

  /** Orchestrator → lịch sử (scope `system` của `withConfigWrite` — R-K2) → quyền; ném lỗi chặn đầu tiên (R06). */
  async #assertDeletable(tx: Tx, id: string): Promise<void> {
    const scopes = await orchScopes(tx, id);
    if (scopes.length > 0) throw inUseError(scopes);
    const access = await agentAccessCounts(tx, id);
    const blocker = deleteBlocker({
      orchestratorScopes: 0,
      hasHistory: await agentHasHistory(tx, id),
      activeEntitlements: access.entitlements,
      grants: access.grants,
    });
    if (blocker === "AGENT_HAS_ACCESS") throw appError(blocker, access);
    if (blocker) throw appError(blocker);
  }

  /** DELETE · 204 · version → chặn → DELETE (cascade `agent_workflows`) → audit `delete` (after null). Trả version mới. */
  async remove(actor: AuthUser, id: string, expected: number): Promise<number> {
    const { version } = await withConfigWrite(this.d, actor, async (tx) => {
      const row = await this.#lockAgent(tx, id, expected);
      await this.#assertDeletable(tx, id);
      const before = auditSnapshot(await this.#detail(tx, row));
      await deleteAgent(tx, id);
      return {
        result: null,
        audit: {
          tenantId: null,
          action: "delete",
          entity: "agent",
          entityId: id,
          entityName: row.key,
          before,
          after: null,
          summary: { fields: [] },
        },
      };
    });
    return version;
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
