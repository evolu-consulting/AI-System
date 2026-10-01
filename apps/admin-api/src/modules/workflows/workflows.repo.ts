// ADM-FR-10, ADM-FR-14, ADM-FR-15 · truy vấn admin.workflows (catalog toàn hệ thống, scope platform). Đếm command/agent
// bằng subquery trong một câu cho cả trang (spec M2 §6). Từ `secrets` chỉ đọc `id`, `name` (quyền cột 0004).
import {
  type InputMap,
  InputMapSchema,
  InputSchemaSchema,
  type WorkflowInput,
} from "@ai/contracts";
import { commands, secrets, type Tx, users, workflows } from "@ai/db";
import { and, asc, count, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import { likeArg } from "../../lib/sql";
import { agentCountExpr } from "./workflows.hub";

export type AppType = "workflow" | "chat" | "agent";
export type WorkflowRow = {
  id: string;
  key: string;
  name: string;
  appType: AppType;
  description: string;
  enabled: boolean;
  secretId: string;
  secretName: string;
  commandCount: number;
  agentCount: number;
  version: number;
  updatedAt: Date;
  updatedBy: string | null;
  baseUrl: string;
  inputSchema: WorkflowInput[];
  outputField: string | null;
  createdAt: Date;
};

const commandCount = sql<number>`(select count(*)::int from ${commands}
  where ${commands.workflowId} = ${workflows.id})`;

function cols(readable: boolean) {
  return {
    id: workflows.id,
    key: workflows.key,
    name: workflows.name,
    appType: workflows.appType,
    description: workflows.description,
    enabled: workflows.enabled,
    secretId: workflows.secretId,
    secretName: secrets.name,
    commandCount,
    agentCount: agentCountExpr(readable, workflows.id),
    version: workflows.version,
    updatedAt: workflows.updatedAt,
    updatedBy: users.username,
    baseUrl: workflows.baseUrl,
    inputSchema: workflows.inputSchema,
    outputField: workflows.outputField,
    createdAt: workflows.createdAt,
  };
}

/** jsonb lệch schema (sửa tay DB) → ném (500, có id), không đoán. */
function toRow(r: Omit<WorkflowRow, "inputSchema"> & { inputSchema: unknown }): WorkflowRow {
  const s = InputSchemaSchema.safeParse(r.inputSchema);
  if (!s.success) throw new Error(`workflows: input_schema hỏng ở hàng ${r.id}`);
  return { ...r, inputSchema: s.data };
}

export type WorkflowFilter = {
  q?: string;
  status?: "on" | "off";
  attached?: boolean;
  secret?: string;
  limit: number;
  offset: number;
};

const unattachedExpr = (readable: boolean) =>
  sql`(${commandCount} = 0 and ${agentCountExpr(readable, workflows.id)} = 0)`;

/** Điều kiện chung của list và `counts` (trừ chip `status`, `attached`). */
function baseWhere(f: WorkflowFilter): SQL | undefined {
  const q = f.q ? likeArg(f.q) : undefined;
  return and(
    q
      ? or(ilike(workflows.key, q), ilike(workflows.name, q), ilike(workflows.description, q))
      : undefined,
    f.secret ? eq(secrets.name, f.secret) : undefined,
  );
}

function chipWhere(f: WorkflowFilter, readable: boolean): SQL | undefined {
  const un = unattachedExpr(readable);
  return and(
    f.status ? eq(workflows.enabled, f.status === "on") : undefined,
    f.attached === undefined ? undefined : f.attached ? sql`not ${un}` : un,
  );
}

export async function listWorkflows(tx: Tx, f: WorkflowFilter, readable: boolean) {
  const rows = await tx
    .select({ ...cols(readable), total: sql<number>`count(*) over()`.mapWith(Number) })
    .from(workflows)
    .innerJoin(secrets, eq(secrets.id, workflows.secretId))
    .leftJoin(users, eq(users.id, workflows.updatedBy))
    .where(and(baseWhere(f), chipWhere(f, readable)))
    .orderBy(asc(workflows.key))
    .limit(f.limit)
    .offset(f.offset);
  const un = unattachedExpr(readable);
  const [c] = await tx
    .select({
      all: count(),
      on: sql<number>`count(*) filter (where ${workflows.enabled})`.mapWith(Number),
      off: sql<number>`count(*) filter (where not ${workflows.enabled})`.mapWith(Number),
      unattached: sql<number>`count(*) filter (where ${un})`.mapWith(Number),
    })
    .from(workflows)
    .innerJoin(secrets, eq(secrets.id, workflows.secretId))
    .where(baseWhere(f));
  return {
    rows: rows.map((r) => ({ ...toRow(r), total: r.total })),
    counts: c ?? { all: 0, on: 0, off: 0, unattached: 0 },
  };
}

export async function findWorkflow(
  tx: Tx,
  id: string,
  readable: boolean,
): Promise<WorkflowRow | null> {
  const [row] = await tx
    .select(cols(readable))
    .from(workflows)
    .innerJoin(secrets, eq(secrets.id, workflows.secretId))
    .leftJoin(users, eq(users.id, workflows.updatedBy))
    .where(eq(workflows.id, id))
    .limit(1);
  return row ? toRow(row) : null;
}

export async function lockWorkflow(
  tx: Tx,
  id: string,
  lock: "no key update" | "share",
): Promise<{
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  inputSchema: unknown;
} | null> {
  const [row] = await tx
    .select({
      id: workflows.id,
      key: workflows.key,
      name: workflows.name,
      enabled: workflows.enabled,
      inputSchema: workflows.inputSchema,
    })
    .from(workflows)
    .where(eq(workflows.id, id))
    .for(lock);
  return row ?? null;
}

export async function usageCommands(tx: Tx, workflowId: string, limit: number) {
  const rows = await tx
    .select({
      id: commands.id,
      name: commands.name,
      enabled: commands.enabled,
      total: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(commands)
    .where(eq(commands.workflowId, workflowId))
    .orderBy(asc(commands.name))
    .limit(limit);
  return {
    commands: rows.map(({ total: _t, ...c }) => c),
    count: rows[0]?.total ?? 0,
  };
}

/** Input map mọi command (bật hay tắt) của workflow — kiểm SCHEMA_BREAKS_COMMANDS (M2-R18). */
export async function mappedCommands(
  tx: Tx,
  workflowId: string,
): Promise<{ id: string; name: string; inputMap: InputMap }[]> {
  const rows = await tx
    .select({ id: commands.id, name: commands.name, inputMap: commands.inputMap })
    .from(commands)
    .where(eq(commands.workflowId, workflowId));
  return rows.map((r) => ({ ...r, inputMap: InputMapSchema.parse(r.inputMap) }));
}

export type WorkflowValues = {
  name: string;
  description: string;
  appType: AppType;
  baseUrl: string;
  secretId: string;
  inputSchema: WorkflowInput[];
  outputField: string | null;
  enabled: boolean;
};

export async function insertWorkflow(
  tx: Tx,
  w: WorkflowValues & { id: string; key: string; actorId: string },
): Promise<void> {
  const { actorId, ...rest } = w;
  await tx.insert(workflows).values({ ...rest, updatedBy: actorId });
}

export async function bumpWorkflow(
  tx: Tx,
  id: string,
  set: Partial<WorkflowValues>,
  actorId: string,
): Promise<void> {
  await tx
    .update(workflows)
    .set({
      ...set,
      version: sql`${workflows.version} + 1`,
      updatedBy: actorId,
      updatedAt: sql`now()`,
    })
    .where(eq(workflows.id, id));
}

export async function deleteWorkflow(tx: Tx, id: string): Promise<void> {
  await tx.delete(workflows).where(eq(workflows.id, id));
}
