// X1-AC08 (combine) · test-plan §4: chuẩn bị DB test cho e2e combine (Hub thật + Dify mock, không Runtime).
// Chạy bằng bun (webServer đầu tiên của `playwright.config.ts`): reset DB test + migrate Admin (`prepare-db.ts`) + migrate Hub +
// `hub:seed` (orchestrator/profile mặc định) + dữ liệu X1: secret (giá trị SINH lúc chạy), workflow `mock-send`/`mock-dich`
// (`base_url` = Dify mock, `side_effect=false`), command `/mock-send` `/mock-dich`, feature `x1-demo` (entitlement acme,
// grant group `ke-toan` có `lan`), provider `dify`. P1: không đọc `.env` auto-pilot, không key thật.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { runHubMigrations } from "@ai/db/migrate-hub";
import postgres from "postgres";
import { encryptSecret, parseMasterKey } from "../../apps/admin-api/src/lib/secret-crypto";
import { TENANT_ID } from "../../tests/acceptance/M1/_data";
import { id2 } from "../../tests/acceptance/M2/_data";
import { ID3 } from "../../tests/acceptance/M3/_data";
import { prepareDbWithRetry } from "../x1/_prepare";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} chưa đặt — chạy \`bun run keys:dev\``);
  return v;
}

export const X1 = {
  secret: id2(60),
  wfSend: id2(61),
  wfDich: id2(62),
  cmdSend: id2(63),
  cmdDich: id2(64),
  feature: id2(65),
} as const;
const DESC = (s: string) => ({ vi: s, en: s });
const arg = (name: string, o: Record<string, unknown> = {}) => ({
  name,
  description: { vi: `Tham số ${name}`, en: `Argument ${name}` },
  default: null,
  fallback: null,
  rest: false,
  ...o,
});
const inp = (name: string, type: string, required: boolean) => ({
  name,
  type,
  required,
  description: `Biến ${name}`,
});

async function main(): Promise<void> {
  const url = need("TEST_DATABASE_URL");
  prepareDbWithRetry();
  await runHubMigrations({ url, appEnv: "test" });
  execFileSync("bun", ["apps/hub-api/src/modules/seed/seed.ts"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  const difyUrl = `http://localhost:${process.env.COMBINE_DIFY_PORT ?? "4048"}/v1`;
  // Giá trị bí mật SINH lúc chạy (≥ 8 ký tự, không tiền tố `mk-` ⇒ mock Dify trả kịch bản `ok`).
  const secret = `x1-${randomBytes(12).toString("hex")}`;
  const enc = encryptSecret(parseMasterKey(need("SECRET_MASTER_KEY")), X1.secret, secret);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`insert into admin.secrets (id, name, ciphertext, iv, key_version, last4) values
      (${X1.secret}, 'DIFY_MOCK_KEY', ${Buffer.from(enc.ciphertext)}, ${Buffer.from(enc.iv)}, 1, ${secret.slice(-4)})`;
    for (const [id, key] of [
      [X1.wfSend, "mock-send"],
      [X1.wfDich, "mock-dich"],
    ] as const) {
      const inputs =
        key === "mock-send"
          ? [inp("text", "text", true)]
          : [inp("target_lang", "text", true), inp("text", "text", true)];
      await sql`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id,
          input_schema, output_field, enabled) values
        (${id}, ${key}, ${`X1 ${key}`}, ${`Workflow thử ${key} (Dify mock) cho e2e combine X1.`}, 'workflow',
         ${difyUrl}, ${X1.secret}, ${sql.json(inputs as never)}, null, true)`;
    }
    const out = { field: "text", render: "markdown" };
    const cmds = [
      {
        id: X1.cmdSend,
        name: "mock-send",
        wf: X1.wfSend,
        args: [arg("text", { rest: true })],
        map: { text: { source: "arg", value: "text" } },
      },
      {
        id: X1.cmdDich,
        name: "mock-dich",
        wf: X1.wfDich,
        args: [arg("lang", { default: "vi" }), arg("text", { rest: true })],
        map: {
          target_lang: { source: "arg", value: "lang" },
          text: { source: "arg", value: "text" },
        },
      },
    ];
    for (const c of cmds) {
      await sql`insert into admin.commands (id, name, aliases, description, workflow_id, args, input_map, output,
          mode, timeout_s, enabled) values
        (${c.id}, ${c.name}, ${sql.array([])}, ${sql.json(DESC(`Lệnh /${c.name}`))}, ${c.wf},
         ${sql.json(c.args as never)}, ${sql.json(c.map as never)}, ${sql.json(out)}, 'sync', 30, true)`;
      await sql`insert into admin.command_names (name, command_id) values (${c.name}, ${c.id})`;
    }
    await sql`insert into admin.features (id, key, name, status) values
      (${X1.feature}, 'x1-demo', ${sql.json(DESC("X1 demo"))}, 'on')`;
    await sql`insert into admin.feature_commands (feature_id, command_id) values
      (${X1.feature}, ${X1.cmdSend}), (${X1.feature}, ${X1.cmdDich})`;
    await sql`insert into admin.feature_entitlements (feature_id, tenant_id) values (${X1.feature}, ${TENANT_ID.acme})`;
    await sql`insert into admin.feature_grants (tenant_id, feature_id, group_id, user_id) values
      (${TENANT_ID.acme}, ${X1.feature}, ${ID3.group.acmeKeToan}, null)`;
    await sql`insert into hub.providers (key, kind, vendor, max_concurrency, enabled, dev_only)
      values ('dify', 'api', 'dify', 5, true, false) on conflict (key) do nothing`;
    // Hub nạp lại cấu hình theo version (HUB_CONFIG_POLL_S=2 trong config) — bump để chắc chắn thấy dữ liệu vừa chèn.
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1`.catch(
      () => undefined,
    );
    await sql`select pg_notify('hub_config_changed', '')`;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) await main();
