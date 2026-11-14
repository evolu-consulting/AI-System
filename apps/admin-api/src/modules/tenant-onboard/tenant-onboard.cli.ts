// niti-onboard · CLI onboarding tenant từ file khai báo, chạy lại an toàn (idempotent):
//   bun --env-file=.env.local apps/admin-api/src/modules/tenant-onboard/tenant-onboard.cli.ts \
//     --file deploy/tenants/nitigroup.yaml --actor <uuid platform admin> [--mgmt-org <org id mgmt-app>] [--mgmt-source <nguồn>]
// `--mgmt-org`/`--mgmt-source` ghi đè `import.org_id`/`import.source` của file (bản sao evotest dùng nguồn riêng) (gắn org khi đã biết id — xem docs/specs/niti-onboard/tasks.md "Thứ tự chạy").
// CR-159: `users:` có người MỚI ⇒ bắt buộc `--pw-out <file>` (quyền 600, `email<TAB>mật khẩu`, chỉ người mới; không bao giờ in ra
// stdout/stderr/báo cáo); thiếu cờ ⇒ lỗi PW_OUT_REQUIRED trước khi ghi DB. `--dry-run`: chỉ đọc + kiểm file (không cần DB/actor).
// `--password-env <TÊN>`: một mật khẩu chung (đọc từ biến môi trường, không nằm trong repo/yaml/log/báo cáo) cho user MỚI; khi đó
// `--pw-out` không bắt buộc (nếu truyền thì chỉ ghi email). `--no-force-change`: user mới không bị ép đổi mật khẩu (mặc định có ép).
// Env: ADMIN_API_DATABASE_URL (admin_api, NOBYPASSRLS). stdout = báo cáo JSON; exit 0 xong · 1 lỗi (stderr chỉ mã + lý do).
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createDb } from "@ai/db";
import { AppError } from "../../lib/errors";
import { parseSpec } from "./adapters/onboard.schema";
import { passwordFile } from "./adapters/password-file";
import { deptRows, type OnboardSpec, planUsers } from "./domain/onboard.rules";
import { type OnboardOpts, onboardTenant } from "./tenant-onboard.run";

const fail = (error: string, extra: Record<string, unknown> = {}): never => {
  process.stderr.write(`${JSON.stringify({ error, ...extra })}\n`);
  process.exit(1);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dryRun(spec: OnboardSpec): void {
  const { rows, issues } = deptRows(spec);
  if (issues.length > 0) fail("SPEC_INVALID", { issues });
  const plan = planUsers(spec.users, []);
  const out = {
    key: spec.key,
    departments: rows.length,
    users: plan.create.length,
    packs: spec.packs,
    addons: spec.addons,
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

/** Cờ mật khẩu: `--password-env` (rỗng/chưa đặt ⇒ lỗi), `--pw-out`, `--no-force-change`. Không bao giờ in giá trị mật khẩu. */
function onboardOpts(v: {
  "password-env"?: string | undefined;
  "pw-out"?: string | undefined;
  "no-force-change"?: boolean | undefined;
}): OnboardOpts {
  const env = v["password-env"];
  const shared = env ? process.env[env] : undefined;
  if (env && !shared) fail("PASSWORD_ENV_EMPTY", { env });
  const pw = v["pw-out"] ? passwordFile(v["pw-out"]) : undefined;
  return {
    ...(pw ? { savePassword: pw.save, probeSink: pw.probe } : {}),
    ...(shared ? { sharedPassword: shared } : {}),
    forceChange: !v["no-force-change"],
  };
}

async function main(): Promise<void> {
  const { values: v } = parseArgs({
    options: {
      file: { type: "string" },
      actor: { type: "string" },
      "mgmt-org": { type: "string" },
      "mgmt-source": { type: "string" },
      "pw-out": { type: "string" },
      "password-env": { type: "string" },
      "no-force-change": { type: "boolean" },
      "dry-run": { type: "boolean" },
    },
  });
  if (!v.file) fail("MISSING_FILE");
  if (!v["dry-run"] && (!v.actor || !UUID.test(v.actor))) fail("ACTOR_INVALID");
  const file = v.file as string;
  const p = parseSpec(await readFile(file, "utf8"), {
    json: file.endsWith(".json"),
    mgmtOrg: v["mgmt-org"],
    mgmtSource: v["mgmt-source"],
  });
  if (!p.ok) return fail("SPEC_INVALID", { issues: p.issues });
  if (v["dry-run"]) return dryRun(p.spec);
  const opts = onboardOpts(v);
  const url = process.env.ADMIN_API_DATABASE_URL ?? fail("MISSING_ADMIN_API_DATABASE_URL");
  const db = createDb(url, { max: 2 });
  try {
    const report = await onboardTenant(db, p.spec, v.actor as string, opts);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (err) {
    if (err instanceof AppError) fail(err.code, { details: err.details });
    const code = (err as { cause?: { code?: unknown } })?.cause?.code;
    fail("FAILED", { sqlstate: typeof code === "string" ? code : undefined });
  } finally {
    await db.close();
  }
}

await main();
