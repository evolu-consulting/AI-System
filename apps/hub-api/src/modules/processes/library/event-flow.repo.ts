// CR-125 · S2 · "quy trình đang chạy" của công ty cho một sự kiện (vd `contract.submitted`) — đọc ĐÚNG nguồn mà tab Quy trình ở admin và bộ
// điều phối đọc: `hub.company_flows` (Bật) ⨝ def (Thư viện được gán hoặc bản của chính công ty). Một câu SQL cố định (Luật 4c), scope system,
// tenant từ ngữ cảnh gói. Xét theo `position, id` như `candidatesOf`; flow đầu = flow hiển thị, còn lại đếm vào `others`.
// Stage: def Thư viện (dữ liệu cũ) lấy từ BẢN XUẤT BẢN (`process_def_releases`); quy trình CỦA CÔNG TY (CR-127 Z9) lấy `d.stages` hiện hành —
// «Lưu và áp dụng» không tạo bản xuất bản, bộ điều phối (`candidatesOf`) cũng chạy def công ty theo `d.stages` ⇒ MỘT nguồn "quy trình đang bật".
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../../lib/db";
import type { EventFlow } from "../../packs/kit/public";
import { NEVER_TRIGGER } from "./purchase-templates";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT = /^[a-z][a-z0-9_-]{0,39}\.[a-z][a-z0-9_.-]{0,59}$/;

type Row = {
  def_id: string;
  name: string;
  rel_version: number;
  stages: unknown[];
  n: number;
};

/** Câu tra (xuất cho test đếm câu). Flow Bật + def chưa xoá + đúng sự kiện + (def công ty, hoặc def Thư viện đã xuất bản). */
export const EVENT_FLOW_SQL = (tenantId: string, event: string) => sql`
  select d.id as def_id, d.name, coalesce(d.published_version, d.version) as rel_version,
    case when d.tenant_id is null then coalesce(r.stages, d.stages) else d.stages end as stages, count(*) over ()::int as n
  from hub.company_flows cf
  join hub.process_defs d on d.id = cf.flow_id and d.deleted_at is null
    and (d.tenant_id = cf.tenant_id or d.tenant_id is null)
  left join hub.process_def_releases r on r.def_id = d.id and r.rel_version = d.published_version
  where cf.tenant_id = ${tenantId}::uuid and cf.enabled and d.trigger_event = ${event}
    and (d.tenant_id is not null or d.published_version is not null)
    and d.trigger is distinct from ${JSON.stringify(NEVER_TRIGGER)}::text::jsonb
  order by cf.position, cf.id limit 1`;

export async function eventFlowOf(
  db: Db,
  tenantId: string,
  event: string,
): Promise<EventFlow | null> {
  if (!UUID.test(tenantId) || !EVENT.test(event)) return null;
  const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<Row>(EVENT_FLOW_SQL(tenantId, event)),
  );
  if (!r) return null;
  return {
    defId: r.def_id,
    name: r.name,
    relVersion: Number(r.rel_version),
    stages: Array.isArray(r.stages) ? r.stages : [],
    others: Math.max(0, Number(r.n) - 1),
  };
}
