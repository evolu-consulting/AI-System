// I1 · hạ tầng int của importer mgmt-app: DB sạch (mẫu "full" + fixture H1 qua N5: `padmin`), pool `admin_api` + `hub_api`
// (NOBYPASSRLS — đúng role CLI dùng). Bảng đồ thị G1 (pack-knowledge 0003) phải có sẵn trong mẫu — thiếu ⇒ đỏ ngay.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@ai/db";
import { HUB_API_URL } from "../../H1/_fixtures";
import { type CtxN5, startN5 } from "../../N5/_support/n5";
import { ORG_A } from "./fixture";

export type CtxI1 = CtxN5 & { hub: Db; filesDir: string; sinkDir: string };

export async function startI1(): Promise<CtxI1> {
  const ctx = await startN5({ max: 4 });
  const [g] = await ctx.sql<
    { ok: boolean }[]
  >`select to_regclass('knowledge.entities') is not null as ok`;
  if (!g?.ok)
    throw new Error(
      "thiếu bảng G1 (knowledge.entities) trong mẫu DB — migration pack-knowledge 0003_graph chưa chạy",
    );
  const root = await mkdtemp(join(tmpdir(), "i1-"));
  const filesDir = join(root, "contract_files");
  await mkdir(join(filesDir, ORG_A, "c2"), { recursive: true });
  await writeFile(join(filesDir, ORG_A, "c2", "hd.pdf"), "%PDF-1.4 i1");
  const hub = createDb(HUB_API_URL, { max: 4 });
  return {
    ...ctx,
    hub,
    filesDir,
    sinkDir: join(root, "sink"),
    stop: async () => {
      await hub.close();
      await ctx.stop();
    },
  };
}

/** Số hàng các bảng đích (khẳng định dry-run không ghi / chạy lại không nhân đôi). */
export async function counts(ctx: CtxI1): Promise<Record<string, number>> {
  const tables = [
    "contracts.contracts",
    "contracts.approvals",
    "contracts.contract_items",
    "contracts.contract_categories",
    "contracts.contract_events",
    "contracts.contract_reminders",
    "contracts.files",
    "contracts.cks_customers",
    "contracts.cks_lots",
    "contracts.cks_certificates",
    "contracts.cks_renewals",
    "contracts.cks_followups",
    "contracts.cks_signed_docs",
    "contracts.cks_market_prices",
    "contracts.obligations",
    "contracts.partner_events",
    "contracts.partner_event_voids",
    "contracts.legacy_records",
    "contracts.visibility_settings",
    "knowledge.documents",
    "knowledge.chunks",
    "knowledge.entities",
    "knowledge.chunk_entities",
    "knowledge.entity_rels",
    "knowledge.chunk_links",
    "knowledge.document_links",
    "admin.tenants",
    "admin.users",
    "admin.user_managers",
  ];
  const out: Record<string, number> = {};
  for (const t of tables) {
    const [r] = await ctx.sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${t}`);
    out[t] = r?.n ?? 0;
  }
  return out;
}
