// I1 · CLI chạy một lần: chuyển dữ liệu mgmt-app (OpenSearch + Neo4j, CHỈ ĐỌC) vào Postgres. Dry-run mặc định.
//   bun --env-file=.env.local apps/admin-api/src/modules/mgmt-import/mgmt-import.cli.ts --source mgmt-prod \
//     --actor <uuid platform admin> [--apply] [--batch 500] [--knowledge-org <org id>] [--files-dir <contract_files>] \
//     [--sink-dir <dir>] [--state <checkpoint.json>] [--no-graph] [--diff-sample 20] [--report out.json]
//     [--into-tenant <key>]   niti-onboard: chỉ org đã gắn với tenant đó (docs/specs/niti-onboard/tasks.md)
//     [--filebox]   niti-filebox: file HĐ vào FileBox (org t_<tenant>, như upload của app); env FILEBOX_URL, FILEBOX_TOKEN, [FILEBOX_CA]
//     niti-import (MỘT tài khoản → tenant có sẵn; runbook deploy/prod-sohoptac2/README.md "Nhập dữ liệu chị Tiên"):
//     --into-tenant <key> --owner-email <email cũ> --owner-username <username đích> [--from-export <file mgmt-export.cli>]
//     --into-tenant <key> --rollback [--apply]   hoàn tác lô nhãn `--source` (dry-run mặc định)
// Env: MGMT_OPENSEARCH_URL, [MGMT_INDEX_PREFIX], [MGMT_NEO4J_URL (HTTP :7474), MGMT_NEO4J_USER, MGMT_NEO4J_PASSWORD],
//      ADMIN_API_DATABASE_URL (admin_api), HUB_DATABASE_URL (hub_api). Không dùng role chủ.
// stdout = báo cáo JSON; exit 0 khớp · 2 có vấn đề hàng/lệch đối soát · 1 lỗi cấu hình/hệ thống (stderr chỉ mã lỗi).
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createDb } from "@ai/db";
import { type RunConfig, runMgmtImport } from "./mgmt-import.run";
import { ownerBad, runOwner } from "./owner.run";

const fail = (error: string, extra: Record<string, unknown> = {}): never => {
  process.stderr.write(`${JSON.stringify({ error, ...extra })}\n`);
  process.exit(1);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const env = (k: string): string => process.env[k] ?? fail(`MISSING_${k}`);

/** niti-import: chế độ MỘT tài khoản / hoàn tác cần tenant đích; email cũ + username đích hợp lệ. */
function ownerArgs(v: {
  "owner-email"?: string;
  "owner-username"?: string;
  rollback?: boolean;
  "into-tenant"?: string;
}): void {
  const email = v["owner-email"];
  if ((email || v.rollback) && !v["into-tenant"]) fail("OWNER_NEEDS_INTO_TENANT");
  if (!email) return;
  if (!/^[a-z0-9._-]{2,32}$/.test(v["owner-username"] ?? "")) fail("BAD_OWNER_USERNAME");
  if (!/^[^@\s]{1,64}@[^@\s]{1,255}$/.test(email)) fail("BAD_OWNER_EMAIL");
}

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
      filebox: { type: "boolean", default: false },
      "owner-email": { type: "string" },
      "owner-username": { type: "string" },
      "from-export": { type: "string" },
      rollback: { type: "boolean", default: false },
    },
  });
  if (!v.source || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(v.source)) fail("BAD_SOURCE");
  if (!v.actor || !UUID.test(v.actor)) fail("ACTOR_INVALID");
  const into = v["into-tenant"];
  if (into !== undefined && !/^[a-z0-9-]{2,32}$/.test(into)) fail("BAD_INTO_TENANT");
  ownerArgs(v);
  const batch = /^\d{1,4}$/.test(v.batch ?? "") ? Number(v.batch) : 0;
  if (batch < 1 || batch > 2000) fail("BAD_BATCH");
  if (v.filebox && v["sink-dir"]) fail("SINK_CONFLICT");
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
    opensearch: {
      // niti-import: nguồn = file export ⇒ không cần OpenSearch
      url: v["from-export"] ? "" : env("MGMT_OPENSEARCH_URL"),
      prefix: process.env.MGMT_INDEX_PREFIX ?? "",
    },
    neo4j: neoUrl
      ? { url: neoUrl, user: env("MGMT_NEO4J_USER"), password: env("MGMT_NEO4J_PASSWORD") }
      : null,
    filesDir: v["files-dir"] ?? null,
    sinkDir: v["sink-dir"] ?? null,
    filebox: v.filebox
      ? {
          url: env("FILEBOX_URL"),
          token: env("FILEBOX_TOKEN"),
          caPath: process.env.FILEBOX_CA || undefined,
        }
      : null,
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
    let bad: boolean;
    let report: unknown;
    if (v["owner-email"] || v.rollback) {
      // niti-import: MỘT tài khoản ⇒ tenant đã có (`--into-tenant`), user đích theo username; hoặc hoàn tác lô `--source`
      const r = await runOwner(adminDb, hubDb, {
        ...cfg,
        tenantKey: v["into-tenant"] as string,
        ownerEmail: v["owner-email"] ?? null,
        ownerUsername: v["owner-username"] ?? null,
        exportFile: v["from-export"] ?? null,
        rollback: v.rollback ?? false,
      });
      report = r;
      bad = ownerBad(r);
    } else {
      const r = await runMgmtImport(adminDb, hubDb, cfg);
      report = r;
      bad = Object.keys(r.issues_by_code).length > 0 || r.reconcile?.money_ok === false;
    }
    const text = JSON.stringify(report, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
    if (v.report) await writeFile(v.report, text);
    process.stdout.write(`${text}\n`);
    process.exitCode = bad ? 2 : 0;
  } catch (err) {
    failWith(err);
  } finally {
    await adminDb.close();
    await hubDb.close();
  }
}

await main();
