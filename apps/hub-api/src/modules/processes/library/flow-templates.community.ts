// CR-125 · c5 · mẫu Thư viện "Quản trị duyệt bài" cho gói Community: MỘT bước Duyệt (nhóm `contracts-admin` ⇒ nhóm chủ gói contracts của công ty, ADR-0044)
// rồi Kết thúc · Hiện bài / Ẩn bài. CHỈ dùng bước lõi + tính năng gói đã bật ⇒ công ty có Community là áp dụng được ngay (không cần bật
// gì thêm, D7). Thay mẫu cũ "Duyệt bài Community" (khe, bước tool khoá không áp dụng được ở công ty).

import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { approve, finish, norm } from "./flow-templates.def";

export const COMMUNITY_FLOW_TEMPLATE = {
  id: "0c125000-0000-4000-8000-0000000000c1",
  key: "community-duyet-bai",
  name: "Quản trị duyệt bài",
  description: "Quản trị gói Community duyệt bài mới: duyệt ⇒ hiện bài, từ chối ⇒ ẩn bài.",
  event: "post.created",
  app: "community",
  inputs: [{ key: "post_id", label: "Bài", type: "text", required: true }],
  stages: () =>
    norm([
      approve("duyet-bai", "Quản trị duyệt bài", 0, "contracts-admin", { reject: 2, ret: 2 }),
      finish(1, "shown", "Hiện bài"),
      finish(2, "hidden", "Ẩn bài"),
    ]),
};

/** FlowDef đầy đủ (để kiểm bằng `parseFlowDef` / `flowDefIssues`). */
export const communityFlowDef = () => ({
  key: COMMUNITY_FLOW_TEMPLATE.key,
  name: COMMUNITY_FLOW_TEMPLATE.name,
  app: COMMUNITY_FLOW_TEMPLATE.app,
  owner: "library" as const,
  trigger: { event: COMMUNITY_FLOW_TEMPLATE.event },
  stages: COMMUNITY_FLOW_TEMPLATE.stages(),
});

/**
 * Ghi mẫu "Quản trị duyệt bài" (idempotent, id cố định). CR-127 Z9: KHÔNG còn gán cho công ty — công ty tự có quy trình riêng do quản trị nền tảng
 * tạo từ sơ đồ trống. `hub` = pool vai hub_api (scope hệ thống). Chạy lại vô hại.
 */
export async function ensureCommunityDefaultFlow(
  hub: Db,
  _tenantId: string,
  _actorId: string | null,
): Promise<{ created: boolean }> {
  const t = COMMUNITY_FLOW_TEMPLATE;
  return withHubScope(hub, { kind: "system" }, async (tx) => {
    const stages = JSON.stringify(t.stages());
    const ins = await tx.execute<{ id: string }>(sql`insert into hub.process_defs
        (id, tenant_id, key, name, description, input_hint, run_group_ids, stages, token_budget, enabled,
         sources, inputs, trigger, app, published_version)
      values (${t.id}::uuid, null, ${t.key}, ${t.name}, ${t.description}, 'Mã bài', '{}'::uuid[],
        ${stages}::jsonb, null, true, '[]'::jsonb, ${JSON.stringify(t.inputs)}::jsonb,
        ${JSON.stringify({ event: t.event })}::jsonb, ${t.app}, 1)
      on conflict do nothing returning id`);
    if (ins.length > 0)
      await tx.execute(sql`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body, note)
        select d.id, 1, d.name, d.stages, d.slot_body, 'seed mẫu Community CR-125 c5' from hub.process_defs d
        where d.id = ${t.id}::uuid on conflict (def_id, rel_version) do nothing`);
    return { created: ins.length > 0 };
  });
}
