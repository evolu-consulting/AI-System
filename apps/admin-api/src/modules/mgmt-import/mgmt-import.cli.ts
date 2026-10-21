// I1 · CLI chạy một lần: chuyển dữ liệu mgmt-app (OpenSearch + Neo4j, CHỈ ĐỌC) vào Postgres. Dry-run mặc định.
//   bun --env-file=.env.local apps/admin-api/src/modules/mgmt-import/mgmt-import.cli.ts --source mgmt-prod \
//     --actor <uuid platform admin> [--apply] [--batch 500] [--knowledge-org <org id>] [--files-dir <contract_files>] \
//     [--sink-dir <dir>] [--state <checkpoint.json>] [--no-graph] [--diff-sample 20] [--report out.json]
//     [--into-tenant <key>]   niti-onboard: chỉ org đã gắn với tenant đó (docs/specs/niti-onboard/tasks.md)
//     [--filebox]   niti-filebox: file HĐ vào FileBox (org t_<tenant>, như upload của app); env FILEBOX_URL, FILEBOX_TOKEN, [FILEBOX_CA]
//     niti-import (MỘT tài khoản → tenant có sẵn; runbook deploy/prod-sohoptac2/README.md "Nhập dữ liệu chị Tiên"):
//     --into-tenant <key> --owner-email <email cũ> --owner-username <username đích> [--from-export <file mgmt-export.cli>]
//     --into-tenant <key> --rollback [--apply]   hoàn tác lô nhãn `--source` (dry-run mặc định)
//     niti-import2 (phần còn lại của tài khoản, nhãn lô RIÊNG): --include-extras --link-source <nhãn lô chính> [--extras-org <org cũ>]
//       [--data-dir <thư mục data mgmt-app, có chat_files/>] (+ --owner-email/--owner-username/--from-export/--filebox như trên;
//       hoàn tác: --include-extras --rollback --owner-username <u> [--apply]); env FILEBOX_ORG = org đính kèm hub
// Env: MGMT_OPENSEARCH_URL, [MGMT_INDEX_PREFIX], [MGMT_NEO4J_URL (HTTP :7474), MGMT_NEO4J_USER, MGMT_NEO4J_PASSWORD],
//      ADMIN_API_DATABASE_URL (admin_api), HUB_DATABASE_URL (hub_api). Không dùng role chủ.
// stdout = báo cáo JSON; exit 0 khớp · 2 có vấn đề hàng/lệch đối soát · 1 lỗi cấu hình/hệ thống (stderr chỉ mã lỗi).
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createDb, type Db } from "@ai/db";
import { extrasBad } from "./application/extras.usecase";
import { type RunConfig, runMgmtImport } from "./mgmt-import.run";
import { ownerBad, runExtras, runOwner } from "./owner.run";

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

/** niti-import2: `--include-extras` cần tenant + username đích + nhãn lô chính; nhãn riêng khác nhãn chính. */
function extrasArgs(v: {
  "include-extras"?: boolean;
  "link-source"?: string;
  "extras-org"?: string;
  "owner-username"?: string;
  "into-tenant"?: string;
  source?: string;
}): void {
  if (!v["include-extras"]) return;
  if (!v["into-tenant"]) fail("OWNER_NEEDS_INTO_TENANT");
  if (!/^[a-z0-9._-]{2,32}$/.test(v["owner-username"] ?? "")) fail("BAD_OWNER_USERNAME");
  const link = v["link-source"] ?? "";
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(link) || link === v.source) fail("BAD_LINK_SOURCE");
  if (v["extras-org"] !== undefined && !/^[A-Za-z0-9-]{1,128}$/.test(v["extras-org"]))
    fail("BAD_EXTRAS_ORG");
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
      "include-extras": { type: "boolean", default: false },
      "link-source": { type: "string" },
      "extras-org": { type: "string" },
      "data-dir": { type: "string" },
    },
  });
  if (!v.source || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(v.source)) fail("BAD_SOURCE");
  if (!v.actor || !UUID.test(v.actor)) fail("ACTOR_INVALID");
  const into = v["into-tenant"];
  if (into !== undefined && !/^[a-z0-9-]{2,32}$/.test(into)) fail("BAD_INTO_TENANT");
  ownerArgs(v);
  extrasArgs(v);
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

type V = ReturnType<typeof args>["v"];

/** Chạy đúng chế độ; trả báo cáo + cờ "có vấn đề" (exit 2). */
async function dispatch(adminDb: Db, hubDb: Db, v: V, cfg: RunConfig) {
  const owner = {
    ...cfg,
    tenantKey: v["into-tenant"] as string,
    ownerEmail: v["owner-email"] ?? null,
    ownerUsername: v["owner-username"] ?? null,
    exportFile: v["from-export"] ?? null,
    rollback: v.rollback ?? false,
  };
  if (v["include-extras"]) {
    // niti-import2: phần còn lại của tài khoản (chat, CKS, thông báo, báo giá, quét giá, lịch sử chấm điểm) — nhãn lô riêng
    const r = await runExtras(adminDb, hubDb, {
      ...owner,
      linkSource: v["link-source"] as string,
      extrasOrg: v["extras-org"] ?? null,
      dataDir: v["data-dir"] ?? null,
      hubFileOrg: process.env.FILEBOX_ORG || null,
    });
    return { report: r as unknown, bad: extrasBad(r) };
  }
  if (v["owner-email"] || v.rollback) {
    // niti-import: MỘT tài khoản ⇒ tenant đã có (`--into-tenant`), user đích theo username; hoặc hoàn tác lô `--source`
    const r = await runOwner(adminDb, hubDb, owner);
    return { report: r as unknown, bad: ownerBad(r) };
  }
  const r = await runMgmtImport(adminDb, hubDb, cfg);
  return {
    report: r as unknown,
    bad: Object.keys(r.issues_by_code).length > 0 || r.reconcile?.money_ok === false,
  };
}

async function main(): Promise<void> {
  const { v, batch } = args();
  const cfg = config(v, batch);
  const adminDb = createDb(env("ADMIN_API_DATABASE_URL"), { max: 2 });
  const hubDb = createDb(env("HUB_DATABASE_URL"), { max: 2 });
  try {
    const { report, bad } = await dispatch(adminDb, hubDb, v, cfg);
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
