// ADM-FR-01, ADM-NFR-06 · chuẩn bị DB `ai_system_test` cho e2e (test-plan E, G1): reset + migrate + seed + fixture §3 (M1) + danh mục (M2).
// Chạy bằng bun: `bun e2e/support/prepare-db.ts` (đầy đủ, đầu phiên) hoặc `--reset-only` (chỉ dữ liệu, giữa các file spec).
// Bắt buộc DB tên kết thúc `_test` (resetTestDb kiểm). Mật khẩu admin seed đọc từ SEED_ADMIN_PASSWORD (không hard-code).
import { runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { insertBulk, insertFixture, makeHashes } from "../../tests/acceptance/M1/_data";
import { ALL_CATALOG, seedCatalog, truncateCatalog } from "../../tests/acceptance/M2/_data";
import { ALL_PERMISSIONS, seedPermissions } from "../../tests/acceptance/M3/_data";
import { clearUsage } from "../../tests/acceptance/M4/_data";

const SEED_MODULE = "@ai/db/seed";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} chưa đặt — chạy \`bun run keys:dev\` (hoặc đặt trong CI)`);
  return v;
}

type AppRow = Record<string, unknown>;

async function saveAppCatalog(sql: postgres.Sql): Promise<AppRow[]> {
  const [t] = await sql`select to_regclass('admin.app_catalog') as r`;
  if (!t?.r) return [];
  return sql<
    AppRow[]
  >`select key, name, icon, url, audience, required_feature, sso, sort_order, enabled, version
    from admin.app_catalog`;
}

/** Hàng đã lưu quay lại (bảng rỗng sau TRUNCATE); `updated_by` để NULL vì users đã dựng lại. */
async function restoreAppCatalog(sql: postgres.Sql, rows: AppRow[]): Promise<void> {
  if (rows.length === 0) return;
  await sql`insert into admin.app_catalog (key, name, icon, url, audience, required_feature, sso, sort_order, enabled, version)
    select x.key, x.name, x.icon, x.url, x.audience, x.required_feature, x.sso, x.sort_order, x.enabled, x.version
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
      as x(key text, name jsonb, icon text, url text, audience text, required_feature text, sso boolean, sort_order int,
        enabled boolean, version int)
    on conflict (key) do nothing`;
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
    // app-catalog (0016): danh mục app toàn hệ thống (FK `updated_by` → users nên TRUNCATE users CASCADE xoá luôn); URL do admin-api điền
    // lúc khởi động (APP_URL_*) ⇒ giữ nguyên qua lần reset để switcher "Ứng dụng" còn đủ dữ liệu.
    const apps = resetOnly ? await saveAppCatalog(sql) : [];
    // M2: TRUNCATE tường minh cả danh mục (secrets/workflows/commands/features/hub.agent_workflows).
    if (resetOnly) await truncateCatalog(sql);
    // M4 (Q2a, test-plan §5 K12): usage của Hub không theo TRUNCATE tenants CASCADE → xoá tường minh. audit_log
    // append-only (không xoá được) → e2e lọc theo tên/mốc ca; tenant_quotas/quota_alerts theo CASCADE.
    if (resetOnly) await clearUsage(sql);
    // M4 khối D (Q2e): xoá 2FA của mọi user (cascade mã dự phòng); chịu được khi bảng chưa migrate.
    if (resetOnly) {
      const [t] = await sql`select to_regclass('admin.user_totp') as r`;
      if (t?.r) await sql.unsafe("truncate admin.user_totp cascade");
    }
    const { runSeed } = (await import(SEED_MODULE)) as {
      runSeed: (o: {
        url: string;
        adminUsername: string;
        adminPassword: string;
      }) => Promise<unknown>;
    };
    await runSeed({ url, adminUsername, adminPassword });
    // [CR-052] seed tạo admin locale 'en' (mặc định mới); e2e kiểm chữ tiếng Việt sau đăng nhập → đặt 'vi' tường minh.
    await sql`update admin.users set locale = 'vi'`;
    const hashes = await makeHashes();
    await insertFixture(sql, hashes);
    await insertBulk(sql, hashes.pw);
    // M2: fixture danh mục đầy đủ (test-plan §3): secrets, workflows, features, commands, entitlements, agent.
    await seedCatalog(sql, ALL_CATALOG);
    // M3: group, thành viên, grant (test-plan §3). KHÔNG seed feature `phap-che` ở đây (làm lệch số đếm feature của e2e M2, TC-3);
    // spec nào cần thì gọi `seedPhapChe()`. `config_meta` không bị truncate.
    await seedPermissions(sql, { ...ALL_PERMISSIONS, phapChe: false });
    await restoreAppCatalog(sql, apps);
  } finally {
    await sql.end();
  }
  console.log(`e2e:prepare-db OK (${resetOnly ? "reset-only" : "full"})`);
}

main().catch((err) => {
  console.error(`e2e:prepare-db lỗi: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
