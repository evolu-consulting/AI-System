// niti-onboard · CLI onboarding tenant từ file khai báo, chạy lại an toàn (idempotent):
//   bun --env-file=.env.local apps/admin-api/src/modules/tenant-onboard/tenant-onboard.cli.ts \
//     --file deploy/tenants/nitigroup.yaml --actor <uuid platform admin> [--mgmt-org <org id mgmt-app>] [--mgmt-source <nguồn>]
// `--mgmt-org`/`--mgmt-source` ghi đè `import.org_id`/`import.source` của file (bản sao evotest dùng nguồn riêng) (gắn org khi đã biết id — xem docs/specs/niti-onboard/tasks.md "Thứ tự chạy").
// CR-159: `users:` có người MỚI ⇒ bắt buộc `--pw-out <file>` (quyền 600, `email<TAB>mật khẩu`, chỉ người mới; không bao giờ in ra
// stdout/stderr/báo cáo); thiếu cờ ⇒ lỗi PW_OUT_REQUIRED trước khi ghi DB. `--dry-run`: chỉ đọc + kiểm file (không cần DB/actor).
// Env: ADMIN_API_DATABASE_URL (admin_api, NOBYPASSRLS). stdout = báo cáo JSON; exit 0 xong · 1 lỗi (stderr chỉ mã + lý do).
import { appendFile, chmod, readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createDb } from "@ai/db";
import { AppError } from "../../lib/errors";
import { parseSpec } from "./adapters/onboard.schema";
import { deptRows, type OnboardSpec, planUsers } from "./domain/onboard.rules";
import { onboardTenant } from "./tenant-onboard.run";

const fail = (error: string, extra: Record<string, unknown> = {}): never => {
  process.stderr.write(`${JSON.stringify({ error, ...extra })}\n`);
  process.exit(1);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ghi mật khẩu từng người ngay khi sinh (append, quyền 600); không có `--pw-out` ⇒ undefined (use case dừng nếu cần). */
function passwordSink(path: string | undefined) {
  if (!path) return undefined;
  return async (email: string, password: string): Promise<void> => {
    await appendFile(path, `${email}\t${password}\n`, { mode: 0o600 });
    await chmod(path, 0o600);
  };
}

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

async function main(): Promise<void> {
  const { values: v } = parseArgs({
    options: {
      file: { type: "string" },
      actor: { type: "string" },
      "mgmt-org": { type: "string" },
      "mgmt-source": { type: "string" },
      "pw-out": { type: "string" },
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
  const url = process.env.ADMIN_API_DATABASE_URL ?? fail("MISSING_ADMIN_API_DATABASE_URL");
  const db = createDb(url, { max: 2 });
  try {
    const report = await onboardTenant(db, p.spec, v.actor as string, passwordSink(v["pw-out"]));
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
