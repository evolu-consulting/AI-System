// HUB-FR-89 · X1 plan §0 K7, §5.4 bước 8: agent `dify-chatbot` + entitlement tenant chỉ ghi được qua `hub:seed` — chép
// thư mục seed Hub vào thư mục tạm, thêm một file overlay, chạy Hub seed CLI với `HUB_SEED_DIR=<tạm>`, rồi xoá thư mục tạm.
// DB = `DATABASE_URL` (owner) mà người gọi truyền cho script. Seed Hub là upsert (`on conflict`), không xoá agent/grant.
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CHATBOT_AGENT } from "./seed-dify-live.apps";

const ROOT = resolve(import.meta.dir, "../../..");
export const HUB_SEED_CLI = "apps/hub-api/src/modules/seed/seed.ts";
export const DEFAULT_HUB_SEED_DIR = join(ROOT, "apps/hub-api/seed");
export const OVERLAY_FILE = "zz-x1-dify-seed.yaml";

/** Nội dung overlay (JSON là YAML hợp lệ ⇒ không tự viết quoting YAML). Không grant: grant đi qua `/agent-grants`. */
export function overlayYaml(tenantKey: string): string {
  const doc = {
    agents: [
      {
        key: CHATBOT_AGENT.key,
        name: CHATBOT_AGENT.name,
        description: CHATBOT_AGENT.description,
        runtime: "dify-agent",
        profile: "$HUB_SEED_PROFILE",
        runtime_options: { workflow_key: CHATBOT_AGENT.workflow_key },
      },
    ],
    entitlements: [{ agent: CHATBOT_AGENT.key, tenant_key: tenantKey }],
  };
  return `# seed:dify X1 (plan §5.4 bước 8) — file tạm, sinh lúc chạy\n${JSON.stringify(doc, null, 2)}\n`;
}

/** Thư mục tạm = mọi `*.yaml|*.yml` của `srcDir` + overlay. Trả đường dẫn để người gọi xoá. */
export function buildOverlayDir(srcDir: string, tenantKey: string): string {
  const dir = mkdtempSync(join(tmpdir(), "seed-dify-hub-"));
  for (const f of readdirSync(srcDir))
    if (/\.ya?ml$/.test(f)) copyFileSync(join(srcDir, f), join(dir, f));
  writeFileSync(join(dir, OVERLAY_FILE), overlayYaml(tenantKey));
  return dir;
}

/**
 * Chạy Hub seed CLI (tiến trình con, env = env hiện tại + `HUB_SEED_DIR`). Env con không chứa key Dify vì script không
 * bao giờ đưa key vào env. Exit ≠ 0 ⇒ ném lỗi chỉ nêu mã thoát.
 */
export function runHubSeedOverlay(
  env: Record<string, string | undefined>,
  tenantKey: string,
): void {
  const srcDir = env.HUB_SEED_DIR ? resolve(env.HUB_SEED_DIR) : DEFAULT_HUB_SEED_DIR;
  const dir = buildOverlayDir(srcDir, tenantKey);
  try {
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) if (v !== undefined) childEnv[k] = v;
    childEnv.HUB_SEED_DIR = dir;
    childEnv.APP_ENV = env.APP_ENV || "development";
    const p = Bun.spawnSync(["bun", HUB_SEED_CLI], {
      cwd: ROOT,
      env: childEnv,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (p.exitCode !== 0) throw new Error(`hub:seed thoát mã ${p.exitCode}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
