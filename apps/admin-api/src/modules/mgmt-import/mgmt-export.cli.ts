// niti-import · export CHỈ-ĐỌC từ mgmt-app (OpenSearch REST: _search scroll, không ghi gì vào nguồn).
//   bun apps/admin-api/src/modules/mgmt-import/mgmt-export.cli.ts                       ⇒ chỉ in chủ HĐ (email, tên, org, số HĐ)
//   bun apps/admin-api/src/modules/mgmt-import/mgmt-export.cli.ts --owner-email <e> --out /out/export.json
//                                                                                       ⇒ file export đã lọc đúng tài khoản đó (600)
// Env: MGMT_OPENSEARCH_URL, [MGMT_INDEX_PREFIX]. stdout = JSON tóm tắt (chủ HĐ, số bản ghi, sha256 file); lỗi ⇒ exit 1 + mã.
import { chmod, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createOpenSearchReader } from "./adapters/opensearch.reader";
import { runExport } from "./application/owner-export";

const fail = (error: string): never => {
  process.stderr.write(`${JSON.stringify({ error })}\n`);
  process.exit(1);
};

async function main(): Promise<void> {
  const { values: v } = parseArgs({
    options: {
      "owner-email": { type: "string" },
      out: { type: "string" },
      batch: { type: "string", default: "500" },
    },
  });
  const url = process.env.MGMT_OPENSEARCH_URL ?? fail("MISSING_MGMT_OPENSEARCH_URL");
  const email = v["owner-email"] ?? null;
  if (email && !/^[^@\s]{1,64}@[^@\s]{1,255}$/.test(email)) fail("BAD_OWNER_EMAIL");
  if (email && !v.out) fail("OUT_REQUIRED");
  const batch = Number(v.batch);
  if (!Number.isInteger(batch) || batch < 1 || batch > 2000) fail("BAD_BATCH");
  const os = createOpenSearchReader({ url, prefix: process.env.MGMT_INDEX_PREFIX ?? "" });
  const r = await runExport(
    { ...os, graph: async function* () {} },
    { batch, ownerEmail: email, now: new Date() },
  ).catch((e: unknown) =>
    fail(/^[A-Z0-9_]{2,60}$/.test((e as Error)?.message) ? (e as Error).message : "FAILED"),
  );
  let sha256: string | null = null;
  if (r.file && v.out) {
    const text = JSON.stringify(r.file);
    await writeFile(v.out, text, { mode: 0o600 });
    await chmod(v.out, 0o600);
    sha256 = new Bun.CryptoHasher("sha256").update(text).digest("hex");
  }
  const f = r.file;
  const summary = {
    owners: r.owners,
    export: f
      ? {
          out: v.out,
          sha256,
          owner_email: f.owner_email,
          source_orgs: f.source_orgs,
          docs: Object.fromEntries(Object.entries(f.docs).map(([k, x]) => [k, x.length])),
          excluded: f.excluded,
          not_imported: f.not_imported,
          counts_all: f.counts_all,
        }
      : null,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
