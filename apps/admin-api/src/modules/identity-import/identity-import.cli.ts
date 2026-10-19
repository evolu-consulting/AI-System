// N5-FR-05, N5-FR-06 · CLI admin chạy một lần: chuyển user mgmt-app sang admin-api (spec N5 §3). Dry-run mặc định.
//   bun --env-file=.env.local apps/admin-api/src/modules/identity-import/identity-import.cli.ts \
//     --file export.json --actor <uuid platform admin> [--apply] [--batch 500]
// stdout = báo cáo JSON; exit 0 không lỗi · 2 có lỗi hàng · 1 lỗi file/actor/hệ thống. N5-NFR-02: stderr chỉ mã lỗi/SQLSTATE,
// không bao giờ message Postgres (23514 chép giá trị hàng — có thể là hash) hay nội dung file.
import { parseArgs } from "node:util";
import { createDb } from "@ai/db";
import { ImportAbort, runIdentityImport } from "./identity-import.run";

const fail = (error: string, extra: Record<string, unknown> = {}): never => {
  process.stderr.write(`${JSON.stringify({ error, ...extra })}\n`);
  process.exit(1);
};

/** `--batch` phải là số nguyên 1..1000; sai ⇒ exit 1 (security L4: `abc` ⇒ NaN ⇒ 0 user mà exit 0). */
function parseBatch(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = /^\d{1,4}$/.test(v) ? Number(v) : Number.NaN;
  return n >= 1 && n <= 1000 ? n : fail("BAD_BATCH");
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Bun.file(path).text());
  } catch {
    return fail("BAD_FILE");
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      actor: { type: "string" },
      apply: { type: "boolean", default: false },
      batch: { type: "string" },
    },
  });
  if (!values.file) fail("MISSING_FILE");
  if (!values.actor) fail("ACTOR_INVALID");
  const url = process.env.ADMIN_API_DATABASE_URL;
  if (!url) fail("MISSING_ADMIN_API_DATABASE_URL");
  const batch = parseBatch(values.batch);
  const raw = await readJson(values.file as string);
  const db = createDb(url as string, { max: 2 });
  try {
    const report = await runIdentityImport(db, raw, {
      actorId: values.actor as string,
      apply: values.apply ?? false,
      batch,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.issues.length > 0 ? 2 : 0;
  } catch (err) {
    if (err instanceof ImportAbort) fail(err.code);
    const code = (err as { code?: unknown; cause?: { code?: unknown } })?.cause?.code;
    fail("FAILED", typeof code === "string" ? { sqlstate: code } : {});
  } finally {
    await db.close();
  }
}

await main();
