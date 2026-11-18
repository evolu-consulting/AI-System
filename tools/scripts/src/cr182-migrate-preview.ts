// CR-182 · cr182-migrate · bản xem trước migration hub 0160: CHỈ ĐỌC (mọi câu trong giao dịch `read only`). In số quy trình / bước / công ty sẽ được điền vai,
// trường hợp mơ hồ (Ký nhiều người, Ký ở mẫu Thư viện, nhóm không còn / công ty thiếu nhóm cùng mã) và số lượt đang duyệt dở (giữ ảnh chụp cũ).
// Chạy: DATABASE_URL=<chủ DB> bun run tools/scripts/src/cr182-migrate-preview.ts [--i-know-prod]. DB không ở loopback/*.localhost/*.test ⇒ bắt buộc
// `--i-know-prod`; KHÔNG in giá trị DATABASE_URL.
import postgres from "postgres";
import { type PreviewDef, previewPlan } from "./cr182-migrate-preview.rules";

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost|.+\.test)$/;
export const isLocalHost = (url: string): boolean => {
  try {
    return LOCAL.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

async function main(argv: readonly string[]): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("cr182-migrate-preview: cần DATABASE_URL");
  if (!isLocalHost(url) && !argv.includes("--i-know-prod"))
    throw new Error(
      "cr182-migrate-preview: DB không phải máy local — thêm --i-know-prod (script chỉ SELECT)",
    );
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin("read only", async (tx) => {
      const defs = await tx<
        PreviewDef[]
      >`select id::text as id, tenant_id::text as tenant_id, key, stages from hub.process_defs
        where deleted_at is null and coalesce(slot, '') not like 'dlc.%' and jsonb_typeof(stages) = 'array'
          and (stages::text like '%"review"%' or stages::text like '%contracts-esign-send%')`;
      const g = await tx<
        { id: string; key: string; tenant_id: string }[]
      >`select id::text as id, key, tenant_id::text as tenant_id from admin.groups`;
      const cf = await tx<
        { flow_id: string; tenant_id: string }[]
      >`select flow_id::text as flow_id, tenant_id::text as tenant_id from hub.company_flows`;
      const runs = await tx<
        { process_def_id: string; n: number }[]
      >`select process_def_id::text as process_def_id, count(*)::int as n from hub.process_runs
        where status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer') group by 1`;
      const assigned = new Map<string, string[]>();
      for (const r of cf)
        assigned.set(r.flow_id, [...(assigned.get(r.flow_id) ?? []), r.tenant_id]);
      const out = previewPlan({
        defs,
        groupIds: new Set(g.map((x) => `${x.tenant_id}:${x.id}`)),
        groupKeys: new Set(g.map((x) => `${x.tenant_id}:${x.key}`)),
        assigned,
        activeRuns: new Map(runs.map((r) => [r.process_def_id, r.n])),
      });
      console.log(`Quy trình được điền vai: ${out.defs} (${out.stages} bước)`);
      console.log(
        `Công ty bị ảnh hưởng: ${out.tenants.length}${out.tenants.length ? ` — ${out.tenants.join(", ")}` : ""}`,
      );
      console.log(
        `Lượt đang chạy của các quy trình đó (giữ ảnh chụp cũ, KHÔNG đổi): ${out.activeRuns}`,
      );
      console.log(`Mơ hồ (${out.ambiguous.length}):`);
      for (const l of out.ambiguous) console.log(`  - ${l}`);
      console.log(`Sẽ «Chưa giao người» (${out.unassigned.length}):`);
      for (const l of out.unassigned) console.log(`  - ${l}`);
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  });
