// CR-127 · Z7 · quy trình CỦA CÔNG TY cho test (đường gán mẫu dùng chung đã gỡ ⇒ fixture là def của chính công ty): dựng bằng SQL cùng hình với
// kết quả «Tạo quy trình» + «Áp dụng» (đã áp dụng: xuất bản bản 1 + dòng `company_flows` Bật; nháp: chưa xuất bản + dòng Tắt `not_published`).
import type { Sql } from "@ai/test-kit/db";

const STAGES = [
  {
    key: "dau",
    name: "Đầu",
    step: 0,
    executor: { kind: "set", values: [] },
    after: { kind: "auto", branch: [] },
    answerer: { kind: "starter" },
    real_action: false,
  },
  {
    key: "xong",
    name: "Xong",
    step: 1,
    outcome: "approved",
    executor: { kind: "set", values: [] },
  },
];

export async function seedCompanyFlow(
  o: Sql,
  w: {
    tenantId: string;
    key: string;
    trigger: object;
    /** Mặc định 2 bước `set` (đủ hợp lệ); truyền `stages` để thử bước duyệt/nhóm. */
    stages?: unknown[];
    app?: string;
    /** `false` = nháp (chưa xuất bản/áp dụng). Mặc định đã áp dụng (Bật). */
    applied?: boolean;
    position?: number;
  },
): Promise<{ flowId: string; rowId: string }> {
  const applied = w.applied !== false;
  const st = JSON.stringify(w.stages ?? STAGES);
  const [d] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, published_version)
    values (${w.tenantId}::uuid, ${w.key}, ${w.key}, ${st}::text::jsonb, ${o.json(w.trigger as never)}, ${w.app ?? "contracts"},
      ${applied ? 1 : null}) returning id::text as id`;
  const flowId = d?.id as string;
  if (applied)
    await o`insert into hub.process_def_releases (def_id, rel_version, name, stages)
      values (${flowId}::uuid, 1, ${w.key}, ${st}::text::jsonb)`;
  const [cf] = await o<{ id: string }[]>`insert into hub.company_flows
      (tenant_id, flow_id, enabled, position, off_reason)
    values (${w.tenantId}::uuid, ${flowId}::uuid, ${applied}, ${w.position ?? 0}, ${applied ? null : "not_published"})
    returning id::text as id`;
  return { flowId, rowId: cf?.id as string };
}
