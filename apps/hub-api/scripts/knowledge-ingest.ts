// R1 · nạp hàng loạt tài liệu (vd thư mục tài liệu mgmt-app) vào kho tri thức của MỘT tenant — `ingestService` (parse DOCX/PDF
// qua worker, chia đoạn, đồ thị). DSN: `KNOWLEDGE_DATABASE_URL` ‖ `HUB_DATABASE_URL` (role chỉ SET ROLE `knowledge_rw`).
// Đồ thị: `KNOWLEDGE_GRAPH_AI=on|fake` (on cần ANTHROPIC_API_KEY). Mỗi tệp một lần nạp (tuần tự — worker xử lý 1 tệp/lúc).
//   bun --env-file=../../.env.local scripts/knowledge-ingest.ts --tenant <uuid> [--user <uuid>] <tệp|thư mục>...
import { readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { createDb } from "@ai/db";
import { createHubAiClient } from "../src/lib/ai-client/ai-client.env";
import { fileConverters, ingestService } from "../src/modules/knowledge/knowledge.mount";

const EXT = new Set([".md", ".markdown", ".txt", ".docx", ".pdf"]);
const args = process.argv.slice(2);
const opt = (k: string): string | undefined => {
  const i = args.indexOf(`--${k}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const tenant = opt("tenant");
const user = opt("user") ?? null;
const dsn = process.env.KNOWLEDGE_DATABASE_URL || process.env.HUB_DATABASE_URL;
if (!tenant || args.length === 0 || !dsn) {
  console.error(
    "dùng: knowledge-ingest.ts --tenant <uuid> [--user <uuid>] <tệp|thư mục>... (cần KNOWLEDGE_DATABASE_URL/HUB_DATABASE_URL)",
  );
  process.exit(2);
}

function walk(p: string): string[] {
  if (statSync(p).isDirectory()) return readdirSync(p).flatMap((n) => walk(join(p, n)));
  return EXT.has(extname(p).toLowerCase()) ? [p] : [];
}

const db = createDb(dsn, { max: 2 });
const files = fileConverters();
// F-07: LLM đồ thị qua AI client chung — usage/trần token ghi bằng pool Hub (`HUB_DATABASE_URL`, role hub_api)
const hubDsn = process.env.HUB_DATABASE_URL;
const hubDb = hubDsn ? createDb(hubDsn, { max: 1 }) : null;
const ingest = ingestService(db, { files, aiClient: hubDb ? createHubAiClient(hubDb) : null });
let failed = 0;
for (const path of args.flatMap(walk)) {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const r = await ingest(
    { tenantId: tenant, userId: user },
    { filename: path, bytes, source: "ingest-cli", uri: null },
  );
  if (!r.ok) failed++;
  console.log(
    r.ok
      ? `ok   ${path} · ${r.value.format}/${r.value.kind} · ${r.value.chunks} đoạn${r.value.duplicate ? " · trùng" : ""}${r.value.graph ? ` · đồ thị ${JSON.stringify(r.value.graph)}` : ""}`
      : `lỗi ${path} · ${r.code}`,
  );
}
await files.close();
await db.close();
await hubDb?.close();
process.exit(failed ? 1 : 0);
