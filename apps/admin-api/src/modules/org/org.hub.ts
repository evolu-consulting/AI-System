// CR-189 · Group của phòng ban còn được Hub dùng ở đâu (agent, quy trình, việc duyệt) — qua hàm DEFINER `hub.org_group_refs`
// (hub 0172; `admin_rw` không đọc các bảng đó). Mẫu `groups.hub.ts`: hỏi quyền hàm trong CÙNG transaction, không cache; DB không có Hub ⇒ không có
// tham chiếu; có Hub mà hàm không gọi được ⇒ xoá phòng báo lỗi (fail-closed), tính `access` bỏ phần Hub.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { appError } from "../../lib/errors";
import { pgArray } from "../../lib/sql";

/** `ok` = gọi được hàm; `absent` = DB không có bảng Hub; `broken` = có bảng Hub nhưng hàm vắng/chưa cấp (lỗi triển khai). */
export type OrgRefsState = "ok" | "absent" | "broken";

export async function orgRefsState(tx: Tx): Promise<OrgRefsState> {
  const r = (await tx.execute(sql`select
    coalesce(has_function_privilege(to_regprocedure('hub.org_group_refs(uuid,uuid[])'), 'EXECUTE'), false) as fn,
    to_regclass('hub.agent_grants') is not null as tables`)) as unknown as {
    fn: boolean;
    tables: boolean;
  }[];
  if (r[0]?.fn === true) return "ok";
  return r[0]?.tables === true ? "broken" : "absent";
}

/** Dùng cho tính `access` (chỉ báo, không mất dữ liệu): chỉ `ok` mới đọc Hub, còn lại bỏ qua phần Hub. */
export async function orgRefsReadable(tx: Tx): Promise<boolean> {
  return (await orgRefsState(tx)) === "ok";
}

export type GroupRefCounts = {
  agents: number;
  processes: number;
  reviewsOpen: number;
  reviewsAny: number;
};

/**
 * Tham chiếu Hub tới MỘT nhóm (đếm theo loại) — dùng để QUYẾT ĐỊNH xoá Group nên FAIL-CLOSED: có bảng Hub mà không gọi được
 * hàm ⇒ ném `INTERNAL_ERROR` (`details.reason = "hub_refs_unavailable"`), không xoá. DB không có Hub ⇒ không có gì để mất.
 */
export async function groupRefCounts(tx: Tx, t: string, groupId: string): Promise<GroupRefCounts> {
  const none = { agents: 0, processes: 0, reviewsOpen: 0, reviewsAny: 0 };
  const state = await orgRefsState(tx);
  if (state === "broken") throw appError("INTERNAL_ERROR", { reason: "hub_refs_unavailable" });
  if (state === "absent") return none;
  const rows =
    (await tx.execute(sql`select kind, count(distinct item_id)::int as n, count(*)::int as rows
    from hub.org_group_refs(${t}::uuid, ${pgArray([groupId], "uuid")}) group by kind`)) as unknown as {
      kind: string;
      n: number;
      rows: number;
    }[];
  const by = (k: string, f: "n" | "rows") => rows.find((r) => r.kind === k)?.[f] ?? 0;
  return {
    agents: by("agent", "n"),
    processes: by("process", "n"),
    reviewsOpen: by("review_open", "n"),
    reviewsAny: by("review_any", "rows"),
  };
}

/** Đoạn CTE `hubitems(group_id, kind, item_id)`: agent + quy trình theo các nhóm trong CTE `gs(group_id)`; rỗng khi không đọc được Hub. */
export function hubItemsExpr(readable: boolean, t: string): SQL {
  return readable
    ? sql`select group_id, kind, item_id from hub.org_group_refs(${t}::uuid,
        (select coalesce(array_agg(group_id), '{}'::uuid[]) from gs)) where kind in ('agent', 'process')`
    : sql`select null::uuid as group_id, null::text as kind, null::uuid as item_id where false`;
}
