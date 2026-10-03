// ADM-FR-54 · M4-R14 · ghi import theo mục đã duyệt (plan-cd §8.3): upsert theo key, `version + 1`, `updated_by = actor`,
// không xoá thực thể. Chạy SAU `lockForImport` (§8.4) trong cùng tx `configWrite`; `ch.changed` ngay sau mỗi câu ghi.
// Thứ tự ghi: tenants → groups → workflows → commands (+ command_names) → features (+ feature_commands) → entitlements →
// tenant_quotas → feature_grants. Secret mới đã chèn trước (E4).
import type {
  CommandEl,
  FeatureEl,
  GrantEl,
  GroupEl,
  ImportItem,
  TenantEl,
  WorkflowEl,
} from "@ai/contracts";
import {
  type ConfigSink,
  commandNames,
  commands,
  featureCommands,
  featureEntitlements,
  featureGrants,
  features,
  groups,
  type Tx,
  tenantQuotas,
  tenants,
  workflows,
} from "@ai/db";
import { type AnyColumn, and, eq, inArray, isNull, sql } from "drizzle-orm";
import { commandNames as namesOf } from "../commands/commands.rules";
import { changedQuotas, type Ids, type It, itemsOf } from "./transfer.ids";

export type WriteCtx = { tx: Tx; ch: ConfigSink; ids: Ids; actorId: string };

const bump = (col: AnyColumn) => ({
  version: sql`${col} + 1`,
  updatedAt: sql`now()`,
});
const must = (m: Map<string, string>, k: string): string => {
  const v = m.get(k);
  if (v === undefined) throw new Error(`import: thiếu id cho "${k}"`);
  return v;
};
const minus = (a: readonly string[], b: readonly string[]) => a.filter((x) => !b.includes(x));

async function writeTenants(w: WriteCtx, xs: It<TenantEl>[]): Promise<void> {
  for (const x of xs) {
    const id = must(w.ids.tenants, x.key);
    await w.tx
      .update(tenants)
      .set({
        name: x.after.name,
        maxConcurrentSub: x.after.max_concurrent_sub,
        updatedBy: w.actorId,
        ...bump(tenants.version),
      })
      .where(eq(tenants.id, id));
    w.ch.changed({ entity: "tenant", tenantId: id });
  }
}

async function writeGroups(w: WriteCtx, xs: It<GroupEl>[]): Promise<void> {
  for (const x of xs) {
    const tenantId = must(w.ids.tenants, x.after.tenant);
    const vals = { name: x.after.name, description: x.after.description, updatedBy: w.actorId };
    if (x.op === "add") {
      const [r] = await w.tx
        .insert(groups)
        .values({ ...vals, tenantId, key: x.after.key })
        .returning({ id: groups.id });
      if (r) w.ids.groups.set(x.key, r.id);
    } else {
      const id = must(w.ids.groups, x.key);
      await w.tx
        .update(groups)
        .set({ ...vals, ...bump(groups.version) })
        .where(eq(groups.id, id));
    }
    w.ch.changed({ entity: "group", tenantId });
  }
}

async function writeWorkflows(w: WriteCtx, xs: It<WorkflowEl>[]): Promise<void> {
  for (const x of xs) {
    const e = x.after;
    const vals = {
      name: e.name,
      description: e.description,
      appType: e.app_type,
      baseUrl: e.base_url,
      secretId: must(w.ids.secrets, e.secret),
      inputSchema: e.input_schema,
      outputField: e.output_field,
      enabled: e.enabled,
      updatedBy: w.actorId,
    };
    if (x.op === "add") {
      const [r] = await w.tx
        .insert(workflows)
        .values({ ...vals, key: e.key })
        .returning({ id: workflows.id });
      if (r) w.ids.workflows.set(x.key, r.id);
    } else {
      await w.tx
        .update(workflows)
        .set({ ...vals, ...bump(workflows.version) })
        .where(eq(workflows.id, must(w.ids.workflows, x.key)));
    }
    w.ch.changed({ entity: "workflow", tenantId: null });
  }
}

const commandVals = (w: WriteCtx, e: CommandEl) => ({
  aliases: e.aliases,
  description: e.description,
  workflowId: must(w.ids.workflows, e.workflow),
  args: e.args,
  inputMap: e.input_map,
  output: e.output,
  mode: e.mode,
  timeoutS: e.timeout_s,
  enabled: e.enabled,
  updatedBy: w.actorId,
});

/** Hàng command trước; tên/alias sau khi mọi command đã bỏ tên cũ (đổi alias chéo giữa 2 command không vướng PK). */
async function writeCommands(w: WriteCtx, xs: It<CommandEl>[]): Promise<void> {
  for (const x of xs) {
    if (x.op === "add") {
      const [r] = await w.tx
        .insert(commands)
        .values({ ...commandVals(w, x.after), name: x.after.name })
        .returning({ id: commands.id });
      if (r) w.ids.commands.set(x.key, r.id);
    } else {
      await w.tx
        .update(commands)
        .set({ ...commandVals(w, x.after), ...bump(commands.version) })
        .where(eq(commands.id, must(w.ids.commands, x.key)));
    }
    w.ch.changed({ entity: "command", tenantId: null });
  }
  await writeCommandNames(w, xs);
}

async function writeCommandNames(w: WriteCtx, xs: It<CommandEl>[]): Promise<void> {
  for (const x of xs) {
    const gone = x.before ? minus(namesOf(x.before), namesOf(x.after)) : [];
    if (gone.length === 0) continue;
    const id = must(w.ids.commands, x.key);
    await w.tx
      .delete(commandNames)
      .where(and(eq(commandNames.commandId, id), inArray(commandNames.name, gone)));
  }
  for (const x of xs) {
    const fresh = minus(namesOf(x.after), x.before ? namesOf(x.before) : []);
    if (fresh.length === 0) continue;
    const commandId = must(w.ids.commands, x.key);
    await w.tx.insert(commandNames).values(fresh.map((name) => ({ name, commandId })));
  }
}

async function writeFeatureRow(w: WriteCtx, x: It<FeatureEl>): Promise<string> {
  const e = x.after;
  const vals = {
    name: e.name,
    description: e.description,
    icon: e.icon,
    status: e.status,
    updatedBy: w.actorId,
  };
  if (x.op === "update") {
    const id = must(w.ids.features, x.key);
    await w.tx
      .update(features)
      .set({ ...vals, ...bump(features.version) })
      .where(eq(features.id, id));
    return id;
  }
  const [r] = await w.tx
    .insert(features)
    .values({ ...vals, key: e.key })
    .returning({ id: features.id });
  if (!r) throw new Error("import: insert feature không trả id");
  w.ids.features.set(x.key, r.id);
  return r.id;
}

/** `commands` của feature = thay cả tập (chỉ feature có trong file). */
async function writeFeatures(w: WriteCtx, xs: It<FeatureEl>[]): Promise<void> {
  for (const x of xs) {
    const featureId = await writeFeatureRow(w, x);
    const old = x.before?.commands ?? [];
    const gone = minus(old, x.after.commands).map((n) => must(w.ids.commands, n));
    if (gone.length > 0)
      await w.tx
        .delete(featureCommands)
        .where(
          and(eq(featureCommands.featureId, featureId), inArray(featureCommands.commandId, gone)),
        );
    const fresh = minus(x.after.commands, old);
    if (fresh.length > 0)
      await w.tx
        .insert(featureCommands)
        .values(fresh.map((n) => ({ featureId, commandId: must(w.ids.commands, n) })));
    w.ch.changed({ entity: "feature", tenantId: null });
  }
}

/** Entitlement chỉ thêm (hàng đã thu hồi → bật lại). */
async function writeEntitlements(w: WriteCtx, xs: It<TenantEl>[]): Promise<void> {
  for (const x of xs) {
    const add = minus(x.after.entitlements, x.before?.entitlements ?? []);
    if (add.length === 0) continue;
    const tenantId = must(w.ids.tenants, x.key);
    await w.tx
      .insert(featureEntitlements)
      .values(
        add.map((k) => ({ featureId: must(w.ids.features, k), tenantId, grantedBy: w.actorId })),
      )
      .onConflictDoUpdate({
        target: [featureEntitlements.featureId, featureEntitlements.tenantId],
        set: { revokedAt: null, grantedBy: w.actorId, grantedAt: sql`now()` },
      });
    w.ch.changed({ entity: "entitlement", tenantId });
  }
}

async function writeQuotas(w: WriteCtx, xs: It<TenantEl>[]): Promise<string[]> {
  const touched: string[] = [];
  for (const x of xs) {
    const qs = changedQuotas(x);
    if (qs.length === 0) continue;
    const tenantId = must(w.ids.tenants, x.key);
    for (const q of qs) {
      const featureId = q.feature === null ? null : must(w.ids.features, q.feature);
      const scope =
        featureId === null ? isNull(tenantQuotas.featureId) : eq(tenantQuotas.featureId, featureId);
      await w.tx.delete(tenantQuotas).where(and(eq(tenantQuotas.tenantId, tenantId), scope));
      await w.tx.insert(tenantQuotas).values({
        tenantId,
        featureId,
        maxRuns: q.max_runs,
        maxTokens: q.max_tokens,
        maxUsd: q.max_usd,
        updatedBy: w.actorId,
      });
    }
    w.ch.changed({ entity: "quota", tenantId });
    touched.push(tenantId);
  }
  return touched;
}

async function writeGrants(w: WriteCtx, xs: It<GrantEl>[]): Promise<void> {
  for (const x of xs) {
    const tenantId = must(w.ids.tenants, x.after.tenant);
    await w.tx.insert(featureGrants).values({
      tenantId,
      featureId: must(w.ids.features, x.after.feature),
      groupId: must(w.ids.groups, `${x.after.tenant}/${x.after.group}`),
      grantedBy: w.actorId,
    });
    w.ch.changed({ entity: "grant", tenantId });
  }
}

/** Ghi mọi mục đổi; trả id tenant có quota đổi (để `evaluateTenant` sau commit). */
export async function writeImport(w: WriteCtx, items: readonly ImportItem[]): Promise<string[]> {
  const ts = itemsOf<TenantEl>(items, "tenant");
  await writeTenants(w, ts);
  await writeGroups(w, itemsOf<GroupEl>(items, "group"));
  await writeWorkflows(w, itemsOf<WorkflowEl>(items, "workflow"));
  await writeCommands(w, itemsOf<CommandEl>(items, "command"));
  await writeFeatures(w, itemsOf<FeatureEl>(items, "feature"));
  await writeEntitlements(w, ts);
  const touched = await writeQuotas(w, ts);
  await writeGrants(w, itemsOf<GrantEl>(items, "grant"));
  return touched;
}
