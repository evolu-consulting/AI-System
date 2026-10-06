// ADM-FR-21 · HUB-FR-89 · X1-R01..R05, R14 · `bun run seed:dify -- [--apply] [--apps a,b] [--tenant acme] [--group dify-demo]
// [--rotate-secrets]` (plan X1 §5). Mặc định DRY-RUN: chỉ in kế hoạch, không gọi mạng. Key đọc LÚC CHẠY từ file do
// `DIFY_SEED_ENV_FILE` trỏ tới (bắt buộc, không mặc định), chỉ các biến trong danh sách trắng; không gán vào env tiến trình.
// KHÔNG gọi Dify (không /info, /parameters, không chạy app): chỉ admin-api, Hub `/agent-grants` và Hub seed CLI.
import { readFileSync } from "node:fs";
import { login, makeClient, SeedStepError } from "./seed-dify-live.api";
import { runHubSeedOverlay } from "./seed-dify-live.hub-seed";
import { buildSeedPlan, formatPlan, parseSeedArgs, parseSeedEnv } from "./seed-dify-live.rules";
import {
  ensureAccess,
  ensureAgentGrant,
  ensureCommands,
  ensureFeature,
  ensureGroup,
  ensureSecrets,
  ensureWorkflows,
  findTenant,
  type RunCtx,
} from "./seed-dify-live.run";

type Env = Record<string, string | undefined>;

class ExitError extends Error {}
const fail = (msg: string): never => {
  throw new ExitError(msg);
};

/** Kiểm cờ + file env TRƯỚC mọi lời gọi mạng (AC17). Lỗi chỉ nêu tên biến/cờ, không giá trị. */
function prepare(argv: string[], env: Env) {
  const args = parseSeedArgs(argv);
  if ("error" in args) return fail(`Lỗi cờ: ${args.error}`);
  const file = env.DIFY_SEED_ENV_FILE;
  if (!file)
    return fail("Thiếu DIFY_SEED_ENV_FILE (đường dẫn file .env chứa key Dify; không có mặc định)");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return fail("Không đọc được file do DIFY_SEED_ENV_FILE trỏ tới");
  }
  const parsed = parseSeedEnv(text, args.apps);
  if (!parsed.ok) return fail(`Thiếu biến trong file env: ${parsed.missing.join(", ")}`);
  return { args, apiUrl: parsed.apiUrl, keys: parsed.keys };
}

async function apply(
  p: ReturnType<typeof prepare>,
  env: Env,
  log: (l: string) => void,
): Promise<void> {
  const user = env.SEED_ADMIN_USERNAME;
  const pass = env.SEED_ADMIN_PASSWORD;
  if (!user || !pass)
    fail("Thiếu SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD (platform_admin) cho --apply");
  const adminUrl = env.ADMIN_API_URL || "http://localhost:3001";
  const token = await login(adminUrl, user as string, pass as string);
  const c: RunCtx = {
    admin: makeClient(adminUrl, token),
    log,
    plan: buildSeedPlan(p.args, p.apiUrl),
  };
  const tenant = await findTenant(c);
  const group = await ensureGroup(c, tenant);
  const secretIds = await ensureSecrets(c, p.keys);
  const feature = await ensureFeature(c);
  const wfIds = await ensureWorkflows(c, secretIds);
  await ensureCommands(c, wfIds, feature);
  await ensureAccess(c, { tenant, feature, group });
  if (!c.plan.agent) return;
  log(`hub:seed overlay: agent ${c.plan.agent.key} + entitlement ${c.plan.tenant}`);
  runHubSeedOverlay(env, c.plan.tenant);
  const hub = makeClient(env.HUB_URL_SEED || "http://localhost:4000", token);
  await ensureAgentGrant(c, hub, { tenant, group });
}

/** Lỗi in tên bước + mã; không in `message` gốc của lỗi lạ (có thể mang body). */
function describe(e: unknown): string {
  if (e instanceof ExitError) return e.message;
  if (e instanceof SeedStepError) return `Lỗi bước ${e.step}: HTTP ${e.status} ${e.code}`;
  if (e instanceof Error && e.message.startsWith("hub:seed"))
    return `Lỗi bước hub-seed: ${e.message}`;
  const code = (e as { code?: unknown })?.code;
  return `Lỗi: ${typeof code === "string" ? code : e instanceof Error ? e.name : "UNKNOWN"}`;
}

export async function main(argv: string[], env: Env): Promise<number> {
  const log = (l: string) => console.log(l);
  try {
    const p = prepare(argv, env);
    log(formatPlan(buildSeedPlan(p.args, p.apiUrl)));
    if (!p.args.apply) return 0;
    await apply(p, env, log);
    log("seed:dify xong.");
    return 0;
  } catch (e) {
    console.error(describe(e));
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2), process.env));
