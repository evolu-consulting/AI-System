// HUB-FR-60, HUB-FR-61, HUB-FR-62, HUB-FR-89, HUB-FR-23 · HUB-BR-08 · H1-R16 · H2a-R14 · `hub:seed`: yaml → zod → một
// transaction (owner): `hub_config_version + 1` → đối chiếu `admin.workflows` (H2a plan-db §4) → upsert → NOTIFY
// `hub_config_changed` (plan H1 §3.6). CLI: `bun run hub:seed`.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { z } from "zod";
import { logger } from "../../lib/logger";
import {
  bumpHubConfigVersion,
  insertAgentWorkflows,
  loadCatalogWorkflows,
  loadTenantIds,
  notifyHubConfigChanged,
  type Tx,
  upsertAgents,
  upsertOrchestrator,
  upsertProfiles,
  upsertProviders,
  upsertSideEffectFlags,
  writeAccess,
  writeOrchestratorTenants,
} from "./seed.repo";
import {
  buildSeedPlan,
  planOrchestratorTenants,
  type SeedPlan,
  type SeedSource,
  SeedValidationError,
} from "./seed.rules";
import { resolveWorkflows, workflowKeysOf } from "./seed.workflows";

export type RunHubSeedOptions = { url: string; dir: string; appEnv: string; profile?: string };

/** Thư mục seed mặc định (`apps/hub-api/seed`), không phụ thuộc cwd. */
export const DEFAULT_SEED_DIR = resolve(import.meta.dir, "../../../seed");

/** Đọc mọi `*.yaml|*.yml` (sắp theo tên). yaml hỏng cú pháp → `SeedValidationError` nêu file. */
export function readSeedDir(dir: string): SeedSource[] {
  const files = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
  if (!files.length)
    throw new SeedValidationError([{ path: dir, message: "không có file *.yaml" }]);
  return files.map((name) => {
    try {
      return { name, data: Bun.YAML.parse(readFileSync(join(dir, name), "utf8")) };
    } catch (e) {
      throw new SeedValidationError([
        { path: name, message: `yaml hỏng: ${(e as Error).message}` },
      ]);
    }
  });
}

/**
 * H2b-R13: kiểm `orchestrator_tenants` trước mọi lần ghi (lỗi → `SeedValidationError`, rollback). Tenant lạ → bỏ +
 * `seed-orchestrator-tenant-unknown` (giá trị nằm trong `msg`: logger che trường tên `*key*`).
 */
async function planTenants(tx: Tx, plan: SeedPlan) {
  const entries = plan.orchestratorTenants;
  const tenants = await loadTenantIds(
    tx,
    entries.map((e) => e.tenant_key),
  );
  const r = planOrchestratorTenants({
    entries,
    defaults: plan.orchestrator,
    agents: plan.agents,
    tenants,
  });
  if ("error" in r) throw new SeedValidationError([r.error]);
  const warnings = r.unknownTenants.map((k) => `seed-orchestrator-tenant-unknown: tenant_key=${k}`);
  return { ...r, warnings };
}

export async function runHubSeed(o: RunHubSeedOptions): Promise<{ version: number }> {
  const plan = buildSeedPlan(readSeedDir(o.dir), { appEnv: o.appEnv, profile: o.profile });
  const sql = postgres(o.url, { max: 1, onnotice: () => {} });
  try {
    const { version, warnings } = await sql.begin(async (tx) => {
      const v = await bumpHubConfigVersion(tx);
      const wf = resolveWorkflows(plan, await loadCatalogWorkflows(tx, workflowKeysOf(plan)));
      if (wf.issues.length) throw new SeedValidationError(wf.issues);
      const tenants = await planTenants(tx, plan);
      await upsertProviders(tx, plan.providers);
      await upsertProfiles(tx, plan.profiles);
      await upsertAgents(tx, wf.agents);
      await upsertOrchestrator(tx, plan.orchestrator);
      await writeOrchestratorTenants(tx, tenants);
      await insertAgentWorkflows(tx, wf.agentWorkflows);
      await upsertSideEffectFlags(tx, wf.sideEffectIds);
      const w = await writeAccess(tx, plan);
      await notifyHubConfigChanged(tx, v);
      return { version: v, warnings: [...wf.warnings, ...tenants.warnings, ...w] };
    });
    for (const w of warnings) logger.warn(w, { module: "seed" });
    return { version };
  } finally {
    await sql.end();
  }
}

const SeedCliEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_ENV: z.enum(["development", "test", "production"]),
  HUB_SEED_DIR: z.string().optional(),
  HUB_SEED_PROFILE: z.string().optional(),
});

/** Env CLI; lỗi chỉ nêu tên biến, không in giá trị (URL có mật khẩu). */
export function loadSeedCliEnv(src: Record<string, string | undefined>): RunHubSeedOptions {
  const r = SeedCliEnvSchema.safeParse(src);
  if (!r.success) {
    const names = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "?")))];
    throw new Error(`Env không hợp lệ: ${names.join(", ")}`);
  }
  const e = r.data;
  return {
    url: e.DATABASE_URL,
    appEnv: e.APP_ENV,
    dir: e.HUB_SEED_DIR ? resolve(e.HUB_SEED_DIR) : DEFAULT_SEED_DIR,
    profile: e.HUB_SEED_PROFILE || undefined,
  };
}

if (import.meta.main) {
  try {
    const r = await runHubSeed(loadSeedCliEnv(process.env));
    logger.info(`hub:seed OK: hub_config_version = ${r.version}`, { module: "seed" });
  } catch (err) {
    logger.fatal(`hub:seed lỗi: ${(err as Error).message}`, { module: "seed" });
    process.exit(1);
  }
}
