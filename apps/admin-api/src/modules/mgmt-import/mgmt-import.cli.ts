// I1 · CLI chạy một lần: chuyển dữ liệu mgmt-app (OpenSearch + Neo4j, CHỈ ĐỌC) vào Postgres. Dry-run mặc định.
//   bun --env-file=.env.local apps/admin-api/src/modules/mgmt-import/mgmt-import.cli.ts --source mgmt-prod \
//     --actor <uuid platform admin> [--apply] [--batch 500] [--knowledge-org <org id>] [--files-dir <contract_files>] \
//     [--sink-dir <dir>] [--state <checkpoint.json>] [--no-graph] [--diff-sample 20] [--report out.json]
//     [--into-tenant <key>]   niti-onboard: chỉ org đã gắn với tenant đó (docs/specs/niti-onboard/tasks.md)
// Env: MGMT_OPENSEARCH_URL, [MGMT_INDEX_PREFIX], [MGMT_NEO4J_URL (HTTP :7474), MGMT_NEO4J_USER, MGMT_NEO4J_PASSWORD],
//      ADMIN_API_DATABASE_URL (admin_api), HUB_DATABASE_URL (hub_api). Không dùng role chủ.
// stdout = báo cáo JSON; exit 0 khớp · 2 có vấn đề hàng/lệch đối soát · 1 lỗi cấu hình/hệ thống (stderr chỉ mã lỗi).
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createDb } from "@ai/db";
import { type RunConfig, runMgmtImport } from "./mgmt-import.run";

const fail = (error: string, extra: Record<string, unknown> = {}): never => {
  process.stderr.write(`${JSON.stringify({ error, ...extra })}\n`);
  process.exit(1);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const env = (k: string): string => process.env[k] ?? fail(`MISSING_${k}`);

function args() {
  const { values: v } = parseArgs({
    options: {
      source: { type: "string" },
      actor: { type: "string" },
      apply: { type: "boolean", default: false },
      batch: { type: "string", default: "500" },
      "knowledge-org": { type: "string" },
      "files-dir": { type: "string" },
      "sink-dir": { type: "string" },
      state: { type: "string" },
      "no-graph": { type: "boolean", default: false },
      "diff-sample": { type: "string", default: "20" },
      report: { type: "string" },
      "into-tenant": { type: "string" },
    },
  });
  if (!v.source || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(v.source)) fail("BAD_SOURCE");
  if (!v.actor || !UUID.test(v.actor)) fail("ACTOR_INVALID");
  const into = v["into-tenant"];
  if (into !== undefined && !/^[a-z0-9-]{2,32}$/.test(into)) fail("BAD_INTO_TENANT");
  const batch = /^\d{1,4}$/.test(v.batch ?? "") ? Number(v.batch) : 0;
  if (batch < 1 || batch > 2000) fail("BAD_BATCH");
  return { v, batch };
}

function config(v: ReturnType<typeof args>["v"], batch: number): RunConfig {
  const neoUrl = process.env.MGMT_NEO4J_URL;
  return {
    source: v.source as string,
    actorId: v.actor as string,
    apply: v.apply ?? false,
    batch,
    knowledgeOrg: v["knowledge-org"] ?? null,
    withGraph: !v["no-graph"] && !!neoUrl,
    diffSample: Number(v["diff-sample"]) || 20,
    opensearch: { url: env("MGMT_OPENSEARCH_URL"), prefix: process.env.MGMT_INDEX_PREFIX ?? "" },
    neo4j: neoUrl
      ? { url: neoUrl, user: env("MGMT_NEO4J_USER"), password: env("MGMT_NEO4J_PASSWORD") }
      : null,
    filesDir: v["files-dir"] ?? null,
    sinkDir: v["sink-dir"] ?? null,
    statePath: v.state ?? null,
    intoTenant: v["into-tenant"] ?? null,
  };
}

/** Lỗi: chỉ mã (SQLSTATE hoặc mã nội bộ dạng HOA_GẠCH) — không bao giờ message Postgres (có thể chép giá trị hàng). */
function failWith(err: unknown): never {
  const code = (err as { cause?: { code?: unknown } })?.cause?.code;
  const msg = (err as Error)?.message ?? "";
  return fail("FAILED", {
    sqlstate: typeof code === "string" ? code : undefined,
    at: /^[A-Z0-9_]{2,60}$/.test(msg) ? msg : undefined,
  });
}

async function main(): Promise<void> {
  const { v, batch } = args();
  const cfg = config(v, batch);
  const adminDb = createDb(env("ADMIN_API_DATABASE_URL"), { max: 2 });
  const hubDb = createDb(env("HUB_DATABASE_URL"), { max: 2 });
  try {
    const report = await runMgmtImport(adminDb, hubDb, cfg);
    const text = JSON.stringify(report, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
    if (v.report) await writeFile(v.report, text);
    process.stdout.write(`${text}\n`);
    const bad =
      Object.keys(report.issues_by_code).length > 0 || report.reconcile?.money_ok === false;
    process.exitCode = bad ? 2 : 0;
  } catch (err) {
    failWith(err);
  } finally {
    await adminDb.close();
    await hubDb.close();
  }
}

await main();
