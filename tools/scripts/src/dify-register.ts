// dify-demo-flow · `bun tools/scripts/src/dify-register.ts --tenant demo --app-id <id> --base-url https://dify.../v1 [--apply]`
// Đăng ký MỘT app Dify (han-muc-duyet) vào sohoptac2: secret (key từ env DIFY_APP_KEY, không bao giờ in) + workflow catalog
// (dify_app_id) + feature (chỉ bật cho --tenant) + lệnh `/han-muc-duyet` + grant cho Group. Mặc định DRY-RUN (không gọi mạng).
// Lặp lại được: mọi bước đọc trước, chỉ ghi khi vắng/khác. KHÔNG gọi Dify. Admin API qua ADMIN_API_URL (mặc định
// http://localhost:3001; trên máy chủ: http://admin-api:3001) với platform admin SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD.
import {
  buildRegisterPlan,
  formatRegisterPlan,
  HMD_FEATURE,
  parseRegisterArgs,
  type RegisterArgs,
} from "./dify-register.rules";
import {
  type Client,
  findExact,
  items,
  login,
  makeClient,
  qs,
  SeedStepError,
} from "./seed-dify-live.api";
import {
  ensureCommands,
  ensureFeature,
  ensureSecrets,
  ensureWorkflows,
  findTenant,
  type RunCtx,
} from "./seed-dify-live.run";

type Env = Record<string, string | undefined>;
type Obj = Record<string, unknown>;
class ExitError extends Error {}
const fail = (msg: string): never => {
  throw new ExitError(msg);
};

/** Group có quyền `contracts-read` của tenant (như tenant-ai-setup), hoặc đúng Group `--group`. */
async function targetGroups(c: RunCtx, tenantId: string, group: string | null): Promise<string[]> {
  if (group) {
    const g = await findExact(c.admin, "group", "/admin/groups", {
      field: "key",
      value: group,
      query: { tenant_id: tenantId },
    });
    if (!g || typeof g.id !== "string") throw new SeedStepError(`group ${group}`, 0, "NOT_FOUND");
    return [g.id];
  }
  const f = await findExact(c.admin, "feature contracts-read", "/admin/features", {
    field: "key",
    value: "contracts-read",
  });
  if (!f) throw new SeedStepError("feature contracts-read", 0, "NOT_FOUND");
  const r = await c.admin.call("grant contracts-read", {
    path: `/admin/grants${qs({ tenant_id: tenantId, feature_id: f.id as string, limit: 200 })}`,
  });
  return groupIds(items(r));
}

function groupIds(rows: Obj[]): string[] {
  const ids: string[] = [];
  for (const r of rows) {
    const s = r.subject as Obj | undefined;
    const g = s?.type === "group" ? (s.group as Obj | undefined) : undefined;
    if (typeof g?.id === "string") ids.push(g.id);
  }
  return [...new Set(ids)];
}

/** Entitlement feature → tenant (đã có ⇒ không ghi) + grant feature → từng Group (đã có ⇒ không ghi). */
async function ensureAccess(
  c: RunCtx,
  ids: { tenant: string; feature: string; groups: string[] },
): Promise<void> {
  const ents = await c.admin.call("entitlement", {
    path: `/admin/features/${ids.feature}/entitlements${qs({ q: c.plan.tenant, limit: 200 })}`,
  });
  const entitled = items(ents).some((e) => e.tenant_id === ids.tenant);
  if (!entitled)
    await c.admin.call("entitlement", {
      method: "PUT",
      path: `/admin/features/${ids.feature}/entitlements/${ids.tenant}`,
    });
  c.log(`entitlement ${HMD_FEATURE.key} → ${c.plan.tenant}: ${entitled ? "giữ nguyên" : "tạo"}`);
  const grants = await c.admin.call("grant", {
    path: `/admin/grants${qs({ tenant_id: ids.tenant, feature_id: ids.feature, limit: 200 })}`,
  });
  const have = new Set(groupIds(items(grants)));
  let added = 0;
  for (const g of ids.groups) {
    if (have.has(g)) continue;
    await c.admin.call("grant", {
      method: "POST",
      path: `/admin/grants${qs({ tenant_id: ids.tenant })}`,
      body: { feature_id: ids.feature, group_id: g },
    });
    added++;
  }
  c.log(
    `grant ${HMD_FEATURE.key} → ${ids.groups.length} Group: thêm ${added}, giữ ${ids.groups.length - added}`,
  );
}

async function apply(a: RegisterArgs, key: string, env: Env, log: (l: string) => void) {
  const user = env.SEED_ADMIN_USERNAME;
  const pass = env.SEED_ADMIN_PASSWORD;
  if (!user || !pass)
    fail("Thiếu SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD (platform_admin) cho --apply");
  const adminUrl = env.ADMIN_API_URL || "http://localhost:3001";
  const token = await login(adminUrl, user as string, pass as string);
  const admin: Client = makeClient(adminUrl, token);
  const c: RunCtx = { admin, log, plan: buildRegisterPlan(a) };
  const tenant = await findTenant(c);
  const secrets = await ensureSecrets(c, new Map(key ? [["han-muc-duyet", key]] : []));
  const feature = await ensureFeature(c);
  const wf = await ensureWorkflows(c, secrets);
  await ensureCommands(c, wf, feature);
  const groups = await targetGroups(c, tenant, a.group);
  if (groups.length === 0)
    log("CẢNH BÁO: không có Group nào để grant (tenant chưa có quyền contracts)");
  await ensureAccess(c, { tenant, feature, groups });
}

/** Lỗi chỉ nêu tên bước + mã; không in `message` gốc của lỗi lạ (có thể mang body/key). */
function describe(e: unknown): string {
  if (e instanceof ExitError) return e.message;
  if (e instanceof SeedStepError) return `Lỗi bước ${e.step}: HTTP ${e.status} ${e.code}`;
  const code = (e as { code?: unknown })?.code;
  return `Lỗi: ${typeof code === "string" ? code : e instanceof Error ? e.name : "UNKNOWN"}`;
}

export async function main(argv: string[], env: Env): Promise<number> {
  const log = (l: string) => console.log(l);
  try {
    const a = parseRegisterArgs(argv);
    if ("error" in a) return fail(`Lỗi cờ: ${a.error}`);
    log(formatRegisterPlan(buildRegisterPlan(a), a));
    if (!a.apply) return 0;
    // DIFY_APP_KEY chỉ cần khi secret CHƯA có (hoặc xoay key); secret đã có ⇒ chạy lại không cần key.
    await apply(a, env.DIFY_APP_KEY?.trim() ?? "", env, log);
    log(
      "dify-register xong. Thử: gõ /han-muc-duyet 600000000 Mua trong Chat AI (tenant " +
        a.tenant +
        "). Để trợ lý gọi workflow trong chat thường: chạy lại `hub:seed` (gắn dify-han-muc-duyet vào agent assistant, không ghi đè chỉnh Studio).",
    );
    return 0;
  } catch (e) {
    console.error(describe(e));
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2), process.env));
