// ADM-FR-20, ADM-FR-21, ADM-BR-01 · truy vấn admin.commands + command_names (catalog toàn hệ thống, scope platform).
// `feature_commands` do module features ghi (qua features.service). jsonb parse bằng zod khi đọc.
import {
  ArgsSchema,
  COMMAND_DESC_MAX,
  type CommandArg,
  type CommandMode,
  CommandOutputSchema,
  type InputMap,
  InputMapSchema,
  LocalizedTextSchema,
} from "@ai/contracts";
import { commandNames, commands, featureCommands, type Tx, workflows } from "@ai/db";
import { and, asc, count, eq, ilike, inArray, ne, or, type SQL, sql } from "drizzle-orm";
import { likeArg, outer, usernameOf } from "../../lib/sql";

const DescSchema = LocalizedTextSchema(COMMAND_DESC_MAX);

export type CommandRow = {
  id: string;
  name: string;
  aliases: string[];
  description: { vi: string; en?: string };
  workflowId: string;
  workflowKey: string;
  workflowName: string;
  workflowEnabled: boolean;
  args: CommandArg[];
  inputMap: InputMap;
  output: { field: string; render: "markdown" | "text" | "json" };
  mode: CommandMode;
  timeoutS: number;
  enabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

const cols = {
  id: commands.id,
  name: commands.name,
  aliases: commands.aliases,
  description: commands.description,
  workflowId: commands.workflowId,
  workflowKey: workflows.key,
  workflowName: workflows.name,
  workflowEnabled: workflows.enabled,
  args: commands.args,
  inputMap: commands.inputMap,
  output: commands.output,
  mode: commands.mode,
  timeoutS: commands.timeoutS,
  enabled: commands.enabled,
  version: commands.version,
  createdAt: commands.createdAt,
  updatedAt: commands.updatedAt,
  updatedBy: usernameOf(commands.updatedBy),
};

type Raw = Omit<CommandRow, "description" | "args" | "inputMap" | "output"> & {
  description: unknown;
  args: unknown;
  inputMap: unknown;
  output: unknown;
};

/** jsonb lệch schema (sửa tay DB) → ném (500, có id), không đoán. */
function toRow(r: Raw): CommandRow {
  const d = DescSchema.safeParse(r.description);
  const a = ArgsSchema.safeParse(r.args);
  const m = InputMapSchema.safeParse(r.inputMap);
  const o = CommandOutputSchema.safeParse(r.output);
  if (!d.success || !a.success || !m.success || !o.success)
    throw new Error(`commands: jsonb hỏng ở hàng ${r.id}`);
  return { ...r, description: d.data, args: a.data, inputMap: m.data, output: o.data };
}

export type CommandFilter = {
  q?: string;
  status?: "on" | "off";
  feature?: string;
  workflow?: string;
  limit: number;
  offset: number;
};

/** Điều kiện chung list + counts (trừ chip `status`). */
function baseWhere(f: CommandFilter): SQL | undefined {
  const q = f.q ? likeArg(f.q) : undefined;
  return and(
    q
      ? or(
          ilike(commands.name, q),
          sql`exists (select 1 from unnest(${outer(commands.aliases)}) a where a ilike ${q})`,
          sql`${commands.description}->>'vi' ilike ${q}`,
          sql`${commands.description}->>'en' ilike ${q}`,
        )
      : undefined,
    f.workflow ? eq(commands.workflowId, f.workflow) : undefined,
    f.feature
      ? sql`exists (select 1 from ${featureCommands} where ${featureCommands.commandId} = ${outer(commands.id)}
          and ${featureCommands.featureId} = ${f.feature})`
      : undefined,
  );
}

export async function listCommands(tx: Tx, f: CommandFilter) {
  const rows = await tx
    .select({ ...cols, total: sql<number>`count(*) over()`.mapWith(Number) })
    .from(commands)
    .innerJoin(workflows, eq(workflows.id, commands.workflowId))
    .where(and(baseWhere(f), f.status ? eq(commands.enabled, f.status === "on") : undefined))
    .orderBy(asc(commands.name))
    .limit(f.limit)
    .offset(f.offset);
  const [c] = await tx
    .select({
      all: count(),
      on: sql<number>`count(*) filter (where ${commands.enabled})`.mapWith(Number),
      off: sql<number>`count(*) filter (where not ${commands.enabled})`.mapWith(Number),
    })
    .from(commands)
    .where(baseWhere(f));
  return {
    rows: rows.map((r) => ({ ...toRow(r), total: r.total })),
    counts: c ?? { all: 0, on: 0, off: 0 },
  };
}

export async function findCommand(tx: Tx, id: string): Promise<CommandRow | null> {
  const [row] = await tx
    .select(cols)
    .from(commands)
    .innerJoin(workflows, eq(workflows.id, commands.workflowId))
    .where(eq(commands.id, id))
    .limit(1);
  return row ? toRow(row) : null;
}

export async function lockCommand(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx
    .select({ id: commands.id })
    .from(commands)
    .where(eq(commands.id, id))
    .for("no key update");
  return rows.length > 0;
}

/** Tên (trong `names`) đã thuộc command khác; trả theo thứ tự `names`. */
export async function takenNames(
  tx: Tx,
  names: readonly string[],
  selfId: string | null,
): Promise<string[]> {
  const rows = await tx
    .select({ name: commandNames.name })
    .from(commandNames)
    .where(
      and(
        inArray(commandNames.name, [...names]),
        selfId ? ne(commandNames.commandId, selfId) : undefined,
      ),
    );
  const taken = new Set(rows.map((r) => r.name));
  return names.filter((n) => taken.has(n));
}

export type CommandValues = {
  name: string;
  aliases: string[];
  description: unknown;
  workflowId: string;
  args: unknown;
  inputMap: unknown;
  output: unknown;
  mode: CommandMode;
  timeoutS: number;
  enabled: boolean;
};

export async function insertCommand(
  tx: Tx,
  v: CommandValues & { id: string; actorId: string },
): Promise<void> {
  const { actorId, ...rest } = v;
  await tx.insert(commands).values({ ...rest, updatedBy: actorId });
}

/** Ghi trường đổi + tăng version (gọi cả khi chỉ tập feature đổi). */
export async function bumpCommand(
  tx: Tx,
  id: string,
  set: Partial<CommandValues>,
  actorId: string,
): Promise<void> {
  await tx
    .update(commands)
    .set({
      ...set,
      version: sql`${commands.version} + 1`,
      updatedBy: actorId,
      updatedAt: sql`now()`,
    })
    .where(eq(commands.id, id));
}

/** Đồng bộ `command_names` với [name, ...aliases]: xoá tên không còn, chèn tên mới (PK bảo đảm unique). */
export async function syncNames(tx: Tx, commandId: string, names: readonly string[]) {
  const cur = (
    await tx
      .select({ name: commandNames.name })
      .from(commandNames)
      .where(eq(commandNames.commandId, commandId))
  ).map((r) => r.name);
  const gone = cur.filter((n) => !names.includes(n));
  const added = names.filter((n) => !cur.includes(n));
  if (gone.length > 0)
    await tx
      .delete(commandNames)
      .where(and(eq(commandNames.commandId, commandId), inArray(commandNames.name, gone)));
  if (added.length > 0)
    await tx.insert(commandNames).values(added.map((name) => ({ name, commandId })));
}

/** Command mới: chèn thẳng mọi tên (PK `command_names_pkey` bảo đảm unique). */
export async function insertNames(tx: Tx, commandId: string, names: readonly string[]) {
  await tx.insert(commandNames).values(names.map((name) => ({ name, commandId })));
}

export async function deleteCommand(tx: Tx, id: string): Promise<void> {
  await tx.delete(commands).where(eq(commands.id, id));
}
