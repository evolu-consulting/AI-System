// HUB-FR-10, HUB-FR-76, HUB-BR-06, HUB-BR-19 · H2a P5, P14, Q4, R23 · catalog Admin trong cache Hub (`CatalogSnapshot`
// bất biến, plan H2a §3–§4) + đầu vào quyền command theo user. Thuần: jsonb validate bằng zod ở biên (CONVENTIONS §5),
// hàng hỏng bị bỏ (không làm hỏng cả catalog), người gọi log.
import {
  ARG_NAME_RE,
  ArgFallbackSchema,
  BETA_GROUP_KEY,
  CommandOutputSchema,
  type FeatureStatus,
  InputMapSchema,
  InputSchemaSchema,
} from "@ai/contracts";
import { z } from "zod";
import type { CatalogCommand, CatalogWorkflow } from "../commands/catalog.types";
import { type CommandAccessInput, usableCommands } from "../commands/command-access.rules";
import type { TenantState, UserState } from "./config.rules";

export type CatalogFeature = { id: string; key: string; status: FeatureStatus };
export type SideEffectSource = "column" | "flags";

/** Ảnh catalog bất biến; nạp lại cùng phần Admin (`config_changed`/poll) → ảnh mới. Khoá ghép `a:b` = chuỗi uuid. */
export type CatalogSnapshot = Readonly<{
  adminVersion: number;
  workflows: ReadonlyMap<string, CatalogWorkflow>;
  /** Mọi command (kể cả tắt), sắp `name`. */
  commands: readonly CatalogCommand[];
  commandById: ReadonlyMap<string, CatalogCommand>;
  /** Tên chính + alias (`admin.command_names`) → command id. */
  names: ReadonlyMap<string, string>;
  features: readonly CatalogFeature[];
  featureIdsByCommand: ReadonlyMap<string, readonly string[]>;
  /** `${tenantId}:${featureId}` có entitlement chưa thu hồi. */
  entitled: ReadonlySet<string>;
  /** `${tenantId}:${featureId}` → group được cấp. */
  grantGroups: ReadonlyMap<string, readonly string[]>;
  /** `${userId}:${featureId}` cấp trực tiếp. */
  grantUsers: ReadonlySet<string>;
  /** tenantId → id group `beta-testers`. */
  betaGroups: ReadonlyMap<string, string>;
  tenantKeys: ReadonlyMap<string, string>;
  sideEffectSource: SideEffectSource;
}>;

/** Hàng thô đọc từ DB (`catalog.repo`). jsonb để `unknown`. */
export type CatalogRows = {
  adminVersion: number;
  workflows: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    appType: string;
    baseUrl: string;
    secretId: string | null;
    inputSchema: unknown;
    outputField: string | null;
    enabled: boolean;
  }[];
  /** null = cột `admin.workflows.side_effect` không tồn tại (R23 → dùng `flags`). */
  sideEffectColumn: { id: string; sideEffect: boolean }[] | null;
  flags: { workflowId: string; sideEffect: boolean }[];
  commands: {
    id: string;
    name: string;
    aliases: string[];
    description: unknown;
    workflowId: string;
    args: unknown;
    inputMap: unknown;
    output: unknown;
    mode: string;
    timeoutS: number;
    enabled: boolean;
  }[];
  names: { name: string; commandId: string }[];
  features: { id: string; key: string; status: string }[];
  featureCommands: { featureId: string; commandId: string }[];
  entitlements: { featureId: string; tenantId: string }[];
  grants: { tenantId: string; featureId: string; groupId: string | null; userId: string | null }[];
  groups: { id: string; tenantId: string; key: string }[];
  tenants: { id: string; key: string }[];
};

export type DroppedRow = { table: "workflows" | "commands" | "features"; id: string };

// Biên jsonb: dễ dãi hơn contract ghi (`en: null` cũ, khoá thừa) nhưng đủ chặt cho Hub dùng.
const LocalizedRow = z
  .object({ vi: z.string().min(1), en: z.string().nullish() })
  .transform(({ vi, en }) => (en ? { vi, en } : { vi }));
const ArgRow = z.object({
  name: z.string().regex(ARG_NAME_RE),
  description: LocalizedRow,
  default: z
    .string()
    .nullish()
    .transform((v) => (v ? v : null)),
  fallback: ArgFallbackSchema.nullish().transform((v) => v ?? null),
  rest: z
    .boolean()
    .nullish()
    .transform((v) => v === true),
});
const AppType = z.enum(["workflow", "chat", "agent"]);
const Mode = z.enum(["sync", "async"]);
const Status = z.enum(["on", "off", "beta"]);

function toWorkflow(
  r: CatalogRows["workflows"][number],
  sideEffect: boolean,
): CatalogWorkflow | null {
  const app = AppType.safeParse(r.appType);
  const inputs = InputSchemaSchema.safeParse(r.inputSchema);
  if (!app.success || !inputs.success) return null;
  return Object.freeze({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    appType: app.data,
    baseUrl: r.baseUrl,
    secretId: r.secretId,
    inputSchema: inputs.data,
    outputField: r.outputField,
    enabled: r.enabled,
    sideEffect,
  });
}

function toCommand(r: CatalogRows["commands"][number]): CatalogCommand | null {
  const description = LocalizedRow.safeParse(r.description);
  const args = z.array(ArgRow).safeParse(r.args);
  const inputMap = InputMapSchema.safeParse(r.inputMap);
  const output = CommandOutputSchema.safeParse(r.output);
  const mode = Mode.safeParse(r.mode);
  if (!description.success || !args.success || !inputMap.success) return null;
  if (!output.success || !mode.success) return null;
  return Object.freeze({
    id: r.id,
    name: r.name,
    aliases: r.aliases,
    description: description.data,
    workflowId: r.workflowId,
    args: args.data,
    inputMap: inputMap.data,
    output: output.data,
    mode: mode.data,
    timeoutS: r.timeoutS,
    enabled: r.enabled,
  });
}

/** R23: cột `admin.workflows.side_effect` nếu có (thắng hoàn toàn), không thì `hub.workflow_flags`. */
function sideEffectMap(rows: CatalogRows): ReadonlyMap<string, boolean> {
  if (rows.sideEffectColumn) return new Map(rows.sideEffectColumn.map((r) => [r.id, r.sideEffect]));
  return new Map(rows.flags.map((f) => [f.workflowId, f.sideEffect]));
}

function buildWorkflows(rows: CatalogRows, dropped: DroppedRow[]): Map<string, CatalogWorkflow> {
  const se = sideEffectMap(rows);
  const out = new Map<string, CatalogWorkflow>();
  for (const r of rows.workflows) {
    const w = toWorkflow(r, se.get(r.id) ?? false);
    if (w) out.set(w.id, w);
    else dropped.push({ table: "workflows", id: r.id });
  }
  return out;
}

/** Command trỏ workflow bị bỏ/không có cũng bị bỏ (Hub không chạy được). */
function buildCommands(
  rows: CatalogRows,
  workflows: ReadonlyMap<string, CatalogWorkflow>,
  dropped: DroppedRow[],
): CatalogCommand[] {
  const out: CatalogCommand[] = [];
  for (const r of rows.commands) {
    const c = workflows.has(r.workflowId) ? toCommand(r) : null;
    if (c) out.push(c);
    else dropped.push({ table: "commands", id: r.id });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function buildFeatures(rows: CatalogRows, dropped: DroppedRow[]): CatalogFeature[] {
  const out: CatalogFeature[] = [];
  for (const f of rows.features) {
    const s = Status.safeParse(f.status);
    if (s.success) out.push(Object.freeze({ id: f.id, key: f.key, status: s.data }));
    else dropped.push({ table: "features", id: f.id });
  }
  return out;
}

function groupBy<T>(xs: readonly T[], key: (x: T) => string, val: (x: T) => string) {
  const m = new Map<string, string[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(val(x));
    else m.set(k, [val(x)]);
  }
  return m;
}

/** Dựng ảnh bất biến từ hàng thô; `dropped` = hàng jsonb/enum hỏng bị bỏ (người gọi log `warn`). */
export function buildCatalog(rows: CatalogRows): {
  catalog: CatalogSnapshot;
  dropped: DroppedRow[];
} {
  const dropped: DroppedRow[] = [];
  const workflows = buildWorkflows(rows, dropped);
  const commands = buildCommands(rows, workflows, dropped);
  const commandById = new Map(commands.map((c) => [c.id, c]));
  const names = new Map(
    rows.names.filter((n) => commandById.has(n.commandId)).map((n) => [n.name, n.commandId]),
  );
  const userGrants = rows.grants.filter((g) => g.userId !== null);
  const groupGrants = rows.grants.filter((g) => g.groupId !== null);
  const catalog: CatalogSnapshot = Object.freeze({
    adminVersion: rows.adminVersion,
    workflows,
    commands: Object.freeze(commands),
    commandById,
    names,
    features: Object.freeze(buildFeatures(rows, dropped)),
    featureIdsByCommand: groupBy(
      rows.featureCommands,
      (x) => x.commandId,
      (x) => x.featureId,
    ),
    entitled: new Set(rows.entitlements.map((e) => `${e.tenantId}:${e.featureId}`)),
    grantGroups: groupBy(
      groupGrants,
      (g) => `${g.tenantId}:${g.featureId}`,
      (g) => g.groupId ?? "",
    ),
    grantUsers: new Set(userGrants.map((g) => `${g.userId}:${g.featureId}`)),
    betaGroups: new Map(
      rows.groups.filter((g) => g.key === BETA_GROUP_KEY).map((g) => [g.tenantId, g.id]),
    ),
    tenantKeys: new Map(rows.tenants.map((t) => [t.id, t.key])),
    sideEffectSource: rows.sideEffectColumn ? "column" : "flags",
  });
  return { catalog, dropped };
}

/** Đầu vào `usableCommands` của một user (= `AccessInput` Admin dựng từ cùng dữ liệu, P5). Tenant thiếu → khoá. */
export function commandAccessInput(
  cat: CatalogSnapshot,
  tenant: TenantState | undefined,
  user: UserState,
): CommandAccessInput {
  const tid = user.tenantId;
  return {
    user: {
      id: user.id,
      active: user.active,
      lockedByTenant: user.lockedByTenant,
      tenantActive: tenant !== undefined && tenant.id === tid && tenant.active,
      groupIds: [...user.groupIds],
    },
    betaGroupId: cat.betaGroups.get(tid) ?? null,
    features: cat.features.map((f) => ({
      id: f.id,
      key: f.key,
      status: f.status,
      entitled: cat.entitled.has(`${tid}:${f.id}`),
      grantGroupIds: cat.grantGroups.get(`${tid}:${f.id}`) ?? [],
      grantUser: cat.grantUsers.has(`${user.id}:${f.id}`),
    })),
    commands: cat.commands.map((c) => ({
      id: c.id,
      enabled: c.enabled,
      workflowEnabled: cat.workflows.get(c.workflowId)?.enabled ?? false,
      featureIds: cat.featureIdsByCommand.get(c.id) ?? [],
    })),
  };
}

export type UsableCatalogCommand = {
  command: CatalogCommand;
  workflow: CatalogWorkflow;
  featureId: string;
};

/** Lệnh user dùng được (HUB-FR-76), sắp `name` — nguồn chung cho menu (B2) và `prepare` (B3). */
export function usableCatalogCommands(
  cat: CatalogSnapshot,
  tenant: TenantState | undefined,
  user: UserState,
): UsableCatalogCommand[] {
  const out: UsableCatalogCommand[] = [];
  for (const u of usableCommands(commandAccessInput(cat, tenant, user))) {
    const command = cat.commandById.get(u.commandId);
    const workflow = command && cat.workflows.get(command.workflowId);
    if (command && workflow) out.push({ command, workflow, featureId: u.featureId });
  }
  return out;
}

/** R15: `tenant_key` cho `difyUser`; tenant thiếu key trong cache ⇒ dùng tenant id (một luật cho lệnh `/`, MCP, agent Dify). */
export function tenantKeyOf(c: Pick<CatalogSnapshot, "tenantKeys">, tenantId: string): string {
  return c.tenantKeys.get(tenantId) ?? tenantId;
}
