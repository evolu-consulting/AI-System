// CR-122 · B · seed 3 flow MẪU vào Thư viện (def Thư viện `tenant_id NULL`, có `trigger` + `app`, KHÔNG khe) và xuất bản bản 1.
// IDEMPOTENT: id cố định + `ON CONFLICT DO NOTHING` (def lẫn release) ⇒ chạy lại không nhân bản, không đè bản đã sửa/xuất bản tiếp.
// Kiểm trước khi ghi: `parseFlowDef` + `flowDefIssues(manifest.events)` — sai ⇒ ném, không ghi gì. Chạy bằng `tools/scripts/src/seed-flow-templates.ts`.
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { flowDefIssues, parseFlowDef } from "@ai/contracts/hub-admin";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import {
  FLOW_TEMPLATE_APP,
  FLOW_TEMPLATE_EVENT,
  FLOW_TEMPLATE_INPUTS,
  FLOW_TEMPLATES,
  flowDefOf,
} from "./flow-templates.def";

export type FlowTemplateSeedReport = { created: string[]; existing: string[] };

/** Kiểm cả ba mẫu (ném khi sai) — dùng chung cho seed và test. */
export function assertFlowTemplatesValid(): void {
  for (const t of FLOW_TEMPLATES) {
    const def = flowDefOf(t);
    const p = parseFlowDef(def);
    if (!p.ok || p.legacy) throw new Error(`flow mẫu ${t.key} không hợp lệ: ${JSON.stringify(p)}`);
    const issues = flowDefIssues(def, CONTRACTS_MANIFEST.events);
    if (issues.length > 0) throw new Error(`flow mẫu ${t.key}: ${JSON.stringify(issues)}`);
  }
}

export async function seedFlowTemplates(hub: Db): Promise<FlowTemplateSeedReport> {
  assertFlowTemplatesValid();
  const report: FlowTemplateSeedReport = { created: [], existing: [] };
  await withHubScope(hub, { kind: "system" }, async (tx) => {
    for (const t of FLOW_TEMPLATES) {
      const stages = JSON.stringify(t.stages());
      const trigger = JSON.stringify({ event: FLOW_TEMPLATE_EVENT });
      const inputs = JSON.stringify(FLOW_TEMPLATE_INPUTS);
      const ins = await tx.execute<{ id: string }>(sql`insert into hub.process_defs
          (id, tenant_id, key, name, description, input_hint, run_group_ids, stages, token_budget, enabled,
           sources, inputs, trigger, app, published_version)
        values (${t.id}::uuid, null, ${t.key}, ${t.name}, ${t.description}, 'Mã hợp đồng', '{}'::uuid[],
          ${stages}::jsonb, null, true, '[]'::jsonb, ${inputs}::jsonb, ${trigger}::jsonb, ${FLOW_TEMPLATE_APP}, 1)
        on conflict do nothing returning id`);
      if (ins.length === 0) {
        report.existing.push(t.key);
        continue;
      }
      await tx.execute(sql`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body, note)
        select d.id, 1, d.name, d.stages, d.slot_body, 'seed flow mẫu CR-122 B' from hub.process_defs d where d.id = ${t.id}::uuid
        on conflict (def_id, rel_version) do nothing`);
      report.created.push(t.key);
    }
  });
  return report;
}
