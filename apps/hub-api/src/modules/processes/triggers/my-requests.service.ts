// CR-126 · cr126-requests-mine · `GET /processes/requests/mine` — yêu cầu (lượt bắt đầu bằng phiếu) MÌNH đã gửi, mới nhất trước, ≤ 50.
// MỘT câu SQL cố định (tên người chờ + kết quả âm gần nhất là subquery theo hàng, không vòng lặp); scope user (RLS tenant) +
// `started_by = me` (index `process_runs_started_by_idx`). Lượt con và lượt chạy thử bị loại.

import type { MyRequestItem, MyRequestsResponse, MyRequestWord } from "@ai/contracts/hub-admin";
import { START_FORM_NODE_KEY } from "@ai/contracts/modules";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { ProcessDeps } from "../core/ports";

export const MY_REQUESTS_LIMIT = 50;
const ACTIVE = new Set([
  "running",
  "waiting_review",
  "waiting_answer",
  "needs_decision",
  "waiting_timer",
]);

/** Trạng thái lượt (+ kết quả quyết âm gần nhất của bước duyệt) → nhóm một chữ. Thuần. */
export function requestWord(status: string, lastNegative: string | null): MyRequestWord {
  if (ACTIVE.has(status)) return "waiting";
  if (status === "done") return lastNegative === "reject" ? "rejected" : "done";
  return lastNegative === "fail" ? "returned" : "rejected";
}

type Row = {
  id: string;
  title: string | null;
  name: string;
  started_at: string | Date;
  status: string;
  last_negative: string | null;
  waiting_for: string | null;
};

export class MyRequestsService {
  constructor(private readonly d: ProcessDeps) {}

  async list(u: AuthUser): Promise<MyRequestsResponse> {
    const rows = await withHubScope(
      this.d.db,
      { kind: "user", tenantId: u.tenantId, userId: u.userId },
      (tx) =>
        tx.execute<Row>(sql`select r.id::text as id, r.snapshot ->> 'name' as name, r.started_at, r.status,
          case when jsonb_typeof(r.inputs) = 'array' then
            (select x ->> 'text' from jsonb_array_elements(r.inputs) x where x ->> 'key' = 'request_title' limit 1) end as title,
          (select t.result from hub.review_tasks t
            where t.process_run_id = r.id and t.tenant_id = r.tenant_id and t.status = 'closed' and t.result in ('reject', 'fail')
            order by t.decided_at desc nulls last limit 1) as last_negative,
          (select string_agg(distinct coalesce(usr.display_name, g.name ->> 'vi', g.name ->> 'en', g.key), ', ')
            from hub.review_tasks t
            join hub.review_task_assignees a on a.task_id = t.id and a.tenant_id = t.tenant_id
            left join admin.users usr on usr.id = a.user_id and usr.tenant_id = t.tenant_id
            left join admin.groups g on g.id = a.group_id and g.tenant_id = t.tenant_id
            where t.process_run_id = r.id and t.tenant_id = r.tenant_id and t.status = 'open') as waiting_for
          from hub.process_runs r
          where r.tenant_id = ${u.tenantId}::uuid and r.started_by = ${u.userId}::uuid and r.parent_run_id is null
            and not r.is_test and r.snapshot -> 'stages' -> 0 ->> 'node' = ${START_FORM_NODE_KEY}
          order by r.started_at desc, r.id desc limit ${MY_REQUESTS_LIMIT}`),
    );
    const items: MyRequestItem[] = rows.map((r) => {
      const word = requestWord(r.status, r.last_negative);
      return {
        run_id: r.id,
        title: r.title || r.name,
        created_at: new Date(r.started_at).toISOString(),
        word,
        waiting_for: word === "waiting" ? r.waiting_for : null,
      };
    });
    return { items };
  }
}
