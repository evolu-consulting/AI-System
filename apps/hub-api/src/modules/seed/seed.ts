// HUB-FR-60, HUB-FR-61, HUB-FR-62, HUB-FR-89 · HUB-BR-08 · H1-R16 · `hub:seed`: yaml → zod → một transaction upsert (owner)
// → `hub_config_version + 1` → NOTIFY `hub_config_changed` (plan H1 §3.6). CLI: `bun run hub:seed`.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { z } from "zod";
import { logger } from "../../lib/logger";
import {
  bumpHubConfigVersion,
  notifyHubConfigChanged,
  upsertAgents,
  upsertOrchestrator,
  upsertProfiles,
  upsertProviders,
  writeAccess,
} from "./seed.repo";
import { buildSeedPlan, type SeedSource, SeedValidationError } from "./seed.rules";

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

export async function runHubSeed(o: RunHubSeedOptions): Promise<{ version: number }> {
  const plan = buildSeedPlan(readSeedDir(o.dir), { appEnv: o.appEnv, profile: o.profile });
  const sql = postgres(o.url, { max: 1, onnotice: () => {} });
  try {
    const { version, warnings } = await sql.begin(async (tx) => {
      const v = await bumpHubConfigVersion(tx);
      await upsertProviders(tx, plan.providers);
      await upsertProfiles(tx, plan.profiles);
      await upsertAgents(tx, plan.agents);
      await upsertOrchestrator(tx, plan.orchestrator);
      const w = await writeAccess(tx, plan);
      await notifyHubConfigChanged(tx, v);
      return { version: v, warnings: w };
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
