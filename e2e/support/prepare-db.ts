// ADM-FR-01, ADM-NFR-06 · chuẩn bị DB `ai_system_test` cho e2e (test-plan E, G1): reset + migrate + seed + fixture §3 (M1) + danh mục (M2).
// Chạy bằng bun: `bun e2e/support/prepare-db.ts` (đầy đủ, đầu phiên) hoặc `--reset-only` (chỉ dữ liệu, giữa các file spec).
// Bắt buộc DB tên kết thúc `_test` (resetTestDb kiểm). Mật khẩu admin seed đọc từ SEED_ADMIN_PASSWORD (không hard-code).
import { runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { insertBulk, insertFixture, makeHashes } from "../../tests/acceptance/M1/_data";
import { ALL_CATALOG, seedCatalog, truncateCatalog } from "../../tests/acceptance/M2/_data";

const SEED_MODULE = "@ai/db/seed";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} chưa đặt — chạy \`bun run keys:dev\` (hoặc đặt trong CI)`);
  return v;
}

async function main(): Promise<void> {
  const url = need("TEST_DATABASE_URL");
  const adminUsername = need("SEED_ADMIN_USERNAME");
  const adminPassword = need("SEED_ADMIN_PASSWORD");
  const resetOnly = process.argv.includes("--reset-only");

  if (!resetOnly) {
    await resetTestDb(url);
    await runMigrations({ url, appEnv: "development" });
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    // M2: TRUNCATE tường minh cả danh mục (secrets/workflows/commands/features/hub.agent_workflows).
    if (resetOnly) await truncateCatalog(sql);
    const { runSeed } = (await import(SEED_MODULE)) as {
      runSeed: (o: {
        url: string;
        adminUsername: string;
        adminPassword: string;
      }) => Promise<unknown>;
    };
    await runSeed({ url, adminUsername, adminPassword });
    const hashes = await makeHashes();
    await insertFixture(sql, hashes);
    await insertBulk(sql, hashes.pw);
    // M2: fixture danh mục đầy đủ (test-plan §3): secrets, workflows, features, commands, entitlements, agent.
    await seedCatalog(sql, ALL_CATALOG);
  } finally {
    await sql.end();
  }
  console.log(`e2e:prepare-db OK (${resetOnly ? "reset-only" : "full"})`);
}

main().catch((err) => {
  console.error(`e2e:prepare-db lỗi: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
