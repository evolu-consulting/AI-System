// CR-125 · G8 · ops-checks · "Cờ quy trình công ty" (`flow_flag`): cấu hình nửa vời (rule D7). Công ty có `hub.company_flows` đang bật mà cờ
// `hub.tenant_flow_settings.flow_triggers` tắt/vắng ⇒ HĐ chạy "cách cũ" dù đã gán quy trình (hai nguồn cho "công ty dùng quy trình nào").
// Gán/áp dụng tự bật cờ (c2) và hub 0126 đã backfill ⇒ chỉ còn khi ai đó chủ động Tạm dừng — vẫn cảnh báo để không bị quên. warn, không crit.
// Một câu SQL tập hợp, tra bằng index `company_flows_enabled_idx (tenant_id, position) where enabled` + PK của cờ (Luật 4c).
import { sql } from "drizzle-orm";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { systemRead } from "./check-kit";

export type FlowFlagAgg = { n: number; sample: string[] };

const SAMPLES = 5;

/** Thuần. 0 ⇒ ok; còn công ty ⇒ warn nêu tên + cách xử lý. */
export function evaluateFlowFlag(a: FlowFlagAgg): OpsCheckResult {
  if (a.n === 0)
    return {
      status: "ok",
      value: { count: 0 },
      message: "Mọi công ty có quy trình được gán đều đang dùng quy trình mới",
    };
  const more = a.n > a.sample.length ? ` và ${a.n - a.sample.length} nữa` : "";
  return {
    status: "warn",
    value: { count: a.n, sample: a.sample },
    message: `${a.n} công ty đã gán quy trình nhưng đang chạy cách cũ (cờ dùng quy trình mới tắt): ${a.sample.slice(0, SAMPLES).join(", ")}${more}`,
    hint: "Admin › Công ty › Quy trình: bấm Lưu và áp dụng (hoặc gán lại) để bật. Công ty đang tạm dừng quy trình — bật lại ở Cài đặt nếu không cố ý.",
  };
}

/** Một câu, văn bản cố định. */
export const flowFlagQuery = () => sql`
  select count(*)::int as n, to_jsonb((array_agg(label order by label))[1:${SAMPLES}]) as sample
  from (
    select coalesce(nullif(tn.name, ''), tn.key) as label
    from admin.tenants tn
    where tn.active
      and exists (select 1 from hub.company_flows f where f.tenant_id = tn.id and f.enabled)
      and not exists (select 1 from hub.tenant_flow_settings s where s.tenant_id = tn.id and s.flow_triggers)) x`;

export const flowFlagCheck: OpsCheck = {
  key: "flow_flag",
  async run(d) {
    const rows = await systemRead(d.db, (tx) => tx.execute<FlowFlagAgg>(flowFlagQuery()));
    const r = rows[0];
    return evaluateFlowFlag({ n: Number(r?.n ?? 0), sample: r?.sample ?? [] });
  },
};
