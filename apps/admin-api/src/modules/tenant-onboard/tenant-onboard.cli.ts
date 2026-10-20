// niti-onboard · CLI onboarding tenant từ file khai báo, chạy lại an toàn (idempotent):
//   bun --env-file=.env.local apps/admin-api/src/modules/tenant-onboard/tenant-onboard.cli.ts \
//     --file deploy/tenants/nitigroup.yaml --actor <uuid platform admin> [--mgmt-org <org id mgmt-app>] [--mgmt-source <nguồn>]
// `--mgmt-org`/`--mgmt-source` ghi đè `import.org_id`/`import.source` của file (bản sao evotest dùng nguồn riêng) (gắn org khi đã biết id — xem docs/specs/niti-onboard/tasks.md "Thứ tự chạy").
// Env: ADMIN_API_DATABASE_URL (admin_api, NOBYPASSRLS). stdout = báo cáo JSON; exit 0 xong · 1 lỗi (stderr chỉ mã + lý do).
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createDb } from "@ai/db";
import { AppError } from "../../lib/errors";
import { onboardTenant } from "./application/onboard.usecase";
import { parseSpec } from "./domain/onboard.rules";

const fail = (error: string, extra: Record<string, unknown> = {}): never => {
  process.stderr.write(`${JSON.stringify({ error, ...extra })}\n`);
  process.exit(1);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const { values: v } = parseArgs({
    options: {
      file: { type: "string" },
      actor: { type: "string" },
      "mgmt-org": { type: "string" },
      "mgmt-source": { type: "string" },
    },
  });
  if (!v.file) fail("MISSING_FILE");
  if (!v.actor || !UUID.test(v.actor)) fail("ACTOR_INVALID");
  const file = v.file as string;
  const p = parseSpec(await readFile(file, "utf8"), {
    json: file.endsWith(".json"),
    mgmtOrg: v["mgmt-org"],
    mgmtSource: v["mgmt-source"],
  });
  if (!p.ok) return fail("SPEC_INVALID", { issues: p.issues });
  const url = process.env.ADMIN_API_DATABASE_URL ?? fail("MISSING_ADMIN_API_DATABASE_URL");
  const db = createDb(url, { max: 2 });
  try {
    const report = await onboardTenant(db, p.spec, v.actor as string);
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
