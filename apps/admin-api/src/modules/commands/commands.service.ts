// ADM-FR-20, ADM-FR-21, ADM-FR-22, ADM-BR-01, ADM-BR-02, ADM-BR-10 · nghiệp vụ commands (plan M2 §5 "Commands", §5.1).
// Không biết HTTP; callback withScope chỉ làm việc DB (TECH-DEBT #13). Khoá: workflow SHARE → command NKU →
// features NKU (id tăng, trong setCommandFeatures). Luật kiểm trên TRẠNG THÁI SAU KHI GHÉP, đúng thứ tự spec §3.
import type {
  Command,
  CommandCreateRequest,
  CommandListItem,
  CommandListQuery,
  CommandListResponse,
  CommandUpdateRequest,
  FeatureRef,
  WorkflowInput,
} from "@ai/contracts";
import { type Db, type DbScope, type Tx, withScope } from "@ai/db";
import type { Actor } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { validationError } from "../../lib/http";
import { afterLock, type TestHooks } from "../../lib/test-hooks";
import {
  attachNewCommand,
  bumpFeaturesOfCommand,
  coreFeatureId,
  featureRefsByCommands,
  lockFeatureRefs,
  missingFeatureIds,
  setCommandFeatures,
} from "../features/features.service";
import {
  lockWorkflowRef,
  readWorkflowSchema,
  type WorkflowRefLocked,
} from "../workflows/workflows.service";
import { isNameConflict } from "./commands.errors";
import * as repo from "./commands.repo";
import {
  type CommandState,
  changedCommandFields,
  checkCommandEnable,
  checkCommandFeatures,
  checkInputMap,
  commandNames,
  defaultTimeout,
  inputMapError,
  inputMapWarnings,
  type RuleError,
} from "./commands.rules";

export type CommandsCtx = { db: Db; hooks?: TestHooks };
export type Call = { ctx: CommandsCtx; actor: Actor; scope: DbScope };

const fail = (e: RuleError | null): void => {
  if (e) throw appError(e.code, e.details);
};

function toItem(r: repo.CommandRow, features: FeatureRef[]): CommandListItem {
  return {
    id: r.id,
    name: r.name,
    aliases: r.aliases,
    description: r.description,
    workflow: {
      id: r.workflowId,
      key: r.workflowKey,
      name: r.workflowName,
      enabled: r.workflowEnabled,
    },
    features,
    mode: r.mode,
    enabled: r.enabled,
    version: r.version,
    updated_at: r.updatedAt.toISOString(),
    updated_by: r.updatedBy,
  };
}

/** `warnings` tính lại từ input_schema hiện tại của workflow mỗi lần đọc/ghi, không lưu (M2-R17). */
async function detail(
  tx: Tx,
  id: string,
  known?: WorkflowRefLocked | null,
  refs?: FeatureRef[],
): Promise<Command> {
  const r = await repo.findCommand(tx, id);
  if (!r) throw appError("NOT_FOUND");
  const features = refs ?? (await featureRefsByCommands(tx, [id])).get(id) ?? [];
  // Vừa ghi xong thì đã có input_schema của workflow (đang giữ SHARE) → bỏ một lượt đọc.
  const schema =
    known && known.id === r.workflowId
      ? known.inputSchema
      : await readWorkflowSchema(tx, r.workflowId);
  return {
    ...toItem(r, features),
    args: r.args,
    input_map: r.inputMap,
    output: r.output,
    timeout_s: r.timeoutS,
    feature_ids: features.map((f) => f.id),
    warnings: inputMapWarnings(schema, r.inputMap),
    created_at: r.createdAt.toISOString(),
  };
}

export async function listCommands(c: Call, q: CommandListQuery): Promise<CommandListResponse> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const { rows, counts } = await repo.listCommands(tx, q);
    const refs = await featureRefsByCommands(
      tx,
      rows.map((r) => r.id),
    );
    return {
      items: rows.map(({ total: _t, ...r }) => toItem(r, refs.get(r.id) ?? [])),
      total: rows[0]?.total ?? 0,
      counts,
    };
  });
}

export function getCommand(c: Call, id: string): Promise<Command> {
  return withScope(c.ctx.db, c.scope, (tx) => detail(tx, id));
}

/** Thứ tự spec §3: COMMAND_NEEDS_FEATURE → INVALID_REFERENCE (workflow, features) → COMMAND_NAME_TAKEN → INPUT_MAP_INVALID → WORKFLOW_DISABLED. */
async function checkState(
  tx: Tx,
  s: CommandState,
  wf: WorkflowRefLocked | null,
  selfId: string | null,
  findMissing: (tx: Tx, ids: string[]) => Promise<string[]> = missingFeatureIds,
): Promise<WorkflowInput[]> {
  fail(checkCommandFeatures(s.featureIds));
  if (!wf) throw appError("INVALID_REFERENCE", { field: "workflow_id", ids: [s.workflowId] });
  const missing = await findMissing(tx, s.featureIds);
  if (missing.length > 0)
    throw appError("INVALID_REFERENCE", { field: "feature_ids", ids: missing });
  await failNameTaken(tx, s, selfId);
  fail(inputMapError(checkInputMap(wf.inputSchema, s.args, s.inputMap)));
  fail(checkCommandEnable(s.enabled, wf));
  return wf.inputSchema;
}

async function failNameTaken(tx: Tx, s: CommandState, selfId: string | null): Promise<void> {
  const [first] = await repo.takenNames(tx, commandNames(s), selfId);
  if (first) throw appError("COMMAND_NAME_TAKEN", { name: first });
}

const valuesOf = (s: CommandState): repo.CommandValues => ({
  name: s.name,
  aliases: s.aliases,
  description: s.description,
  workflowId: s.workflowId,
  args: s.args,
  inputMap: s.inputMap,
  output: s.output,
  mode: s.mode,
  timeoutS: s.timeoutS,
  enabled: s.enabled,
});

/** Ghi command + command_names trong một savepoint; 23505 (đua tên) → tra lại tên → COMMAND_NAME_TAKEN. */
async function writeNames(
  tx: Tx,
  s: CommandState,
  selfId: string | null,
  write: (sp: Tx) => Promise<void>,
) {
  await tx.transaction(write).catch(async (err) => {
    if (!isNameConflict(err)) throw err;
    await failNameTaken(tx, s, selfId);
    throw err;
  });
}

export function createCommand(c: Call, input: CommandCreateRequest): Promise<Command> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const wf = await lockWorkflowRef(tx, input.workflow_id);
    await afterLock(c.ctx.hooks, "command.save");
    const s: CommandState = {
      name: input.name,
      aliases: input.aliases,
      description: input.description,
      workflowId: input.workflow_id,
      args: input.args,
      inputMap: input.input_map,
      output: input.output,
      mode: input.mode,
      timeoutS: input.timeout_s ?? defaultTimeout(input.mode),
      enabled: input.enabled,
      featureIds: input.feature_ids ?? [await coreFeatureId(tx)],
    };
    // Command mới: khoá features ngay ở bước kiểm (workflow SHARE → features NKU; hàng command chưa tồn tại nên
    // không đảo thứ tự khoá) và dùng lại FeatureRef cho response — bớt 3 lượt DB so với setCommandFeatures (perf).
    let refs: FeatureRef[] = [];
    await checkState(tx, s, wf, null, async (t, ids) => {
      refs = await lockFeatureRefs(t, ids);
      return ids.filter((x) => !refs.some((r) => r.id === x));
    });
    const id = Bun.randomUUIDv7();
    await writeNames(tx, s, null, async (sp) => {
      await repo.insertCommand(sp, { ...valuesOf(s), id, actorId: c.actor.userId });
      await repo.insertNames(sp, id, commandNames(s));
    });
    await attachNewCommand(tx, {
      commandId: id,
      featureIds: s.featureIds,
      actorId: c.actor.userId,
    });
    return detail(tx, id, wf, refs);
  });
}

function mergeState(cur: CommandState, i: CommandUpdateRequest): CommandState {
  return {
    name: i.name ?? cur.name,
    aliases: i.aliases ?? cur.aliases,
    description: i.description ?? cur.description,
    workflowId: i.workflow_id ?? cur.workflowId,
    args: i.args ?? cur.args,
    inputMap: i.input_map ?? cur.inputMap,
    output: i.output ?? cur.output,
    mode: i.mode ?? cur.mode,
    timeoutS: i.timeout_s ?? cur.timeoutS,
    enabled: i.enabled ?? cur.enabled,
    featureIds: i.feature_ids ?? cur.featureIds,
  };
}

async function stateOf(tx: Tx, r: repo.CommandRow): Promise<CommandState> {
  const refs = (await featureRefsByCommands(tx, [r.id])).get(r.id) ?? [];
  return {
    name: r.name,
    aliases: r.aliases,
    description: r.description,
    workflowId: r.workflowId,
    args: r.args,
    inputMap: r.inputMap,
    output: r.output,
    mode: r.mode,
    timeoutS: r.timeoutS,
    enabled: r.enabled,
    featureIds: refs.map((f) => f.id),
  };
}

/** Alias trùng tên chính trên trạng thái ghép (PATCH chỉ gửi một bên) → VALIDATION_ERROR (T1, spec §9). */
function checkAliasesNotName(s: CommandState): void {
  if (s.aliases.includes(s.name))
    throw validationError([
      { path: ["aliases"], code: "custom", message: "alias must differ from name" },
    ]);
}

/** Khoá: workflow (của trạng thái ghép) SHARE → command NKU; đọc lại sau khoá. */
async function lockForUpdate(tx: Tx, c: Call, id: string, input: CommandUpdateRequest) {
  const seen = await repo.findCommand(tx, id);
  if (!seen) throw appError("NOT_FOUND");
  const wfId = input.workflow_id ?? seen.workflowId;
  let wf = await lockWorkflowRef(tx, wfId);
  if (!(await repo.lockCommand(tx, id))) throw appError("NOT_FOUND");
  await afterLock(c.ctx.hooks, "command.save");
  const row = await repo.findCommand(tx, id);
  if (!row) throw appError("NOT_FOUND");
  // Workflow của command đổi giữa lúc đọc và khoá (PATCH song song) → giữ thêm workflow mới.
  if (!input.workflow_id && row.workflowId !== wfId) wf = await lockWorkflowRef(tx, row.workflowId);
  return { row, wf };
}

export function updateCommand(c: Call, id: string, input: CommandUpdateRequest): Promise<Command> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const { row, wf } = await lockForUpdate(tx, c, id, input);
    if (row.version !== input.version) {
      const current = await detail(tx, id);
      throw appError("VERSION_CONFLICT", { current, updated_at: current.updated_at });
    }
    const cur = await stateOf(tx, row);
    const next = mergeState(cur, input);
    const changed = changedCommandFields(cur, next);
    if (changed.length === 0) return detail(tx, id);
    checkAliasesNotName(next);
    await checkState(tx, next, wf, id);
    await writeNames(tx, next, id, async (sp) => {
      await repo.bumpCommand(sp, id, valuesOf(next), c.actor.userId);
      if (changed.includes("name") || changed.includes("aliases"))
        await repo.syncNames(sp, id, commandNames(next));
    });
    if (changed.includes("featureIds"))
      await setCommandFeatures(tx, {
        commandId: id,
        featureIds: next.featureIds,
        actorId: c.actor.userId,
      });
    return detail(tx, id, wf);
  });
}

/** Khoá command → tăng version mọi feature chứa nó → xoá (cascade command_names, feature_commands). */
export function deleteCommand(c: Call, id: string): Promise<void> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    if (!(await repo.lockCommand(tx, id))) throw appError("NOT_FOUND");
    await afterLock(c.ctx.hooks, "command.delete");
    await bumpFeaturesOfCommand(tx, id, c.actor.userId);
    await repo.deleteCommand(tx, id);
  });
}
