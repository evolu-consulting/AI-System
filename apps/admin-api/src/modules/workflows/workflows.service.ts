// ADM-FR-10, ADM-FR-11, ADM-FR-13, ADM-FR-14, ADM-FR-15 · nghiệp vụ workflows (plan M2 §5 "Workflows", §5.1).
// Không biết HTTP; callback withScope chỉ làm việc DB (TECH-DEBT #13). Khoá: workflow NKU → secret SHARE (khi đổi).
// Thứ tự kiểm PATCH (spec §3): 404 → version → không đổi gì → INVALID_REFERENCE → WORKFLOW_IN_USE → SCHEMA_BREAKS_COMMANDS.
import {
  InputSchemaSchema,
  USAGES_MAX,
  type Workflow,
  type WorkflowCreateRequest,
  type WorkflowInput,
  type WorkflowListItem,
  type WorkflowListQuery,
  type WorkflowListResponse,
  type WorkflowUpdateRequest,
  type WorkflowUsages,
} from "@ai/contracts";
import { type Db, type DbScope, type Tx, withScope } from "@ai/db";
import type { Actor } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { foreignKeyViolation } from "../../lib/pg-errors";
import { afterLock, type TestHooks } from "../../lib/test-hooks";
import { lockSecretRef } from "../secrets/secrets.service";
import { mapWorkflowConflict } from "./workflows.errors";
import { agentIdsByWorkflow, hubAgentsReadable } from "./workflows.hub";
import * as repo from "./workflows.repo";
import {
  changedWorkflowFields,
  checkSchemaChange,
  checkWorkflowDelete,
  checkWorkflowDisable,
  isUnattached,
  type RuleError,
  type Usages,
  type WorkflowState,
} from "./workflows.rules";

export type WorkflowsCtx = { db: Db; hooks?: TestHooks };
export type Call = { ctx: WorkflowsCtx; actor: Actor; scope: DbScope };

const fail = (e: RuleError | null): void => {
  if (e) throw appError(e.code, e.details);
};

export function toWorkflowItem(r: repo.WorkflowRow): WorkflowListItem {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    app_type: r.appType,
    description: r.description,
    enabled: r.enabled,
    secret: { id: r.secretId, name: r.secretName },
    command_count: r.commandCount,
    agent_count: r.agentCount,
    unattached: isUnattached(r),
    version: r.version,
    updated_at: r.updatedAt.toISOString(),
    updated_by: r.updatedBy,
  };
}

const toWorkflow = (r: repo.WorkflowRow): Workflow => ({
  ...toWorkflowItem(r),
  base_url: r.baseUrl,
  input_schema: r.inputSchema,
  output_field: r.outputField,
  created_at: r.createdAt.toISOString(),
});

async function detail(tx: Tx, id: string): Promise<Workflow> {
  const row = await repo.findWorkflow(tx, id, await hubAgentsReadable(tx));
  if (!row) throw appError("NOT_FOUND");
  return toWorkflow(row);
}

async function usagesOf(tx: Tx, id: string): Promise<WorkflowUsages> {
  const readable = await hubAgentsReadable(tx);
  const cmds = await repo.usageCommands(tx, id, USAGES_MAX);
  const agents = readable ? await agentIdsByWorkflow(tx, id, USAGES_MAX) : { ids: [], count: 0 };
  return {
    commands: cmds.commands,
    agents: agents.ids.map((a) => ({ id: a })),
    command_count: cmds.count,
    agent_count: agents.count,
    agents_available: readable,
  };
}

const asUsages = (u: WorkflowUsages): Usages => ({ commands: u.commands, agents: u.agents });

export async function listWorkflows(c: Call, q: WorkflowListQuery): Promise<WorkflowListResponse> {
  const { rows, counts } = await withScope(c.ctx.db, c.scope, async (tx) =>
    repo.listWorkflows(tx, q, await hubAgentsReadable(tx)),
  );
  return { items: rows.map(toWorkflowItem), total: rows[0]?.total ?? 0, counts };
}

export function getWorkflow(c: Call, id: string): Promise<Workflow> {
  return withScope(c.ctx.db, c.scope, (tx) => detail(tx, id));
}

export function getWorkflowUsages(c: Call, id: string): Promise<WorkflowUsages> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    if (!(await repo.findWorkflow(tx, id, false))) throw appError("NOT_FOUND");
    return usagesOf(tx, id);
  });
}

export function createWorkflow(c: Call, input: WorkflowCreateRequest): Promise<Workflow> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    await lockSecretRef(tx, input.secret_id);
    await afterLock(c.ctx.hooks, "workflow.save");
    const id = Bun.randomUUIDv7();
    const values = {
      id,
      key: input.key,
      actorId: c.actor.userId,
      name: input.name,
      description: input.description,
      appType: input.app_type,
      baseUrl: input.base_url,
      secretId: input.secret_id,
      inputSchema: input.input_schema,
      outputField: input.output_field,
      enabled: input.enabled,
    };
    await tx.transaction((sp) => repo.insertWorkflow(sp, values)).catch(mapWorkflowConflict);
    return detail(tx, id);
  });
}

const stateOf = (r: repo.WorkflowRow): WorkflowState => ({
  name: r.name,
  description: r.description,
  appType: r.appType,
  baseUrl: r.baseUrl,
  secretId: r.secretId,
  inputSchema: r.inputSchema,
  outputField: r.outputField,
  enabled: r.enabled,
});

function mergeState(cur: WorkflowState, i: WorkflowUpdateRequest): WorkflowState {
  return {
    name: i.name ?? cur.name,
    description: i.description ?? cur.description,
    appType: i.app_type ?? cur.appType,
    baseUrl: i.base_url ?? cur.baseUrl,
    secretId: i.secret_id ?? cur.secretId,
    inputSchema: i.input_schema ?? cur.inputSchema,
    outputField: i.output_field === undefined ? cur.outputField : i.output_field,
    enabled: i.enabled ?? cur.enabled,
  };
}

async function checkUpdate(tx: Tx, id: string, cur: WorkflowState, next: WorkflowState) {
  const changed = changedWorkflowFields(cur, next);
  if (changed.includes("secretId")) await lockSecretRef(tx, next.secretId);
  if (cur.enabled && !next.enabled) fail(checkWorkflowDisable(asUsages(await usagesOf(tx, id))));
  if (changed.includes("inputSchema"))
    fail(checkSchemaChange(next.inputSchema, await repo.mappedCommands(tx, id)));
  return changed;
}

export function updateWorkflow(
  c: Call,
  id: string,
  input: WorkflowUpdateRequest,
): Promise<Workflow> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    if (!(await repo.lockWorkflow(tx, id, "no key update"))) throw appError("NOT_FOUND");
    await afterLock(c.ctx.hooks, "workflow.save");
    const row = await repo.findWorkflow(tx, id, await hubAgentsReadable(tx));
    if (!row) throw appError("NOT_FOUND");
    if (row.version !== input.version) {
      const current = toWorkflow(row);
      throw appError("VERSION_CONFLICT", { current, updated_at: current.updated_at });
    }
    const cur = stateOf(row);
    const next = mergeState(cur, input);
    if (changedWorkflowFields(cur, next).length === 0) return toWorkflow(row);
    const changed = await checkUpdate(tx, id, cur, next);
    const set: Partial<repo.WorkflowValues> = {};
    for (const k of changed) Object.assign(set, { [k]: next[k] });
    await repo.bumpWorkflow(tx, id, set, c.actor.userId);
    return detail(tx, id);
  });
}

/** 404 → WORKFLOW_IN_USE (mọi command + agent) → xoá. 23503 (command chèn đua) → đọc lại usages → WORKFLOW_IN_USE. */
export function deleteWorkflow(c: Call, id: string): Promise<void> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    if (!(await repo.lockWorkflow(tx, id, "no key update"))) throw appError("NOT_FOUND");
    fail(checkWorkflowDelete(asUsages(await usagesOf(tx, id))));
    await tx
      .transaction((sp) => repo.deleteWorkflow(sp, id))
      .catch(async (err) => {
        if (!foreignKeyViolation(err)) throw err;
        fail(checkWorkflowDelete(asUsages(await usagesOf(tx, id))));
        throw err;
      });
  });
}

export type WorkflowRefLocked = {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  inputSchema: WorkflowInput[];
};

/** Cho module commands: input_schema hiện tại (đọc không khoá) để tính `warnings` khi đọc command. */
export async function readWorkflowSchema(tx: Tx, id: string): Promise<WorkflowInput[]> {
  return InputSchemaSchema.parse((await repo.inputSchemaOf(tx, id)) ?? []);
}

/** Cho module commands: giữ workflow `FOR SHARE` tới khi commit (chặn tắt/đổi schema/xoá song song); thiếu → null. */
export async function lockWorkflowRef(tx: Tx, id: string): Promise<WorkflowRefLocked | null> {
  const w = await repo.lockWorkflow(tx, id, "share");
  return w ? { ...w, inputSchema: InputSchemaSchema.parse(w.inputSchema) } : null;
}
