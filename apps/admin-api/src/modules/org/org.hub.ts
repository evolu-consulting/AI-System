// CR-189 · Group của phòng ban còn được Hub dùng ở đâu (agent, quy trình, việc duyệt) — qua hàm DEFINER `hub.org_group_refs`
// (hub 0172; `admin_rw` không đọc các bảng đó). Mẫu `groups.hub.ts`: hỏi quyền hàm trong CÙNG transaction, không cache; hàm vắng /
// chưa cấp (DB không có Hub) ⇒ coi như không có tham chiếu (không có bảng Hub thì không có gì để mất).
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { pgArray } from "../../lib/sql";

export async function orgRefsReadable(tx: Tx): Promise<boolean> {
  const r = (await tx.execute(sql`select coalesce(
    has_function_privilege(to_regprocedure('hub.org_group_refs(uuid,uuid[])'), 'EXECUTE'), false) as ok`)) as unknown as {
    ok: boolean;
  }[];
  return r[0]?.ok === true;
}

export type GroupRefCounts = {
  agents: number;
  processes: number;
  reviewsOpen: number;
  reviewsAny: number;
};

/** Tham chiếu Hub tới MỘT nhóm (đếm theo loại). */
export async function groupRefCounts(tx: Tx, t: string, groupId: string): Promise<GroupRefCounts> {
  const none = { agents: 0, processes: 0, reviewsOpen: 0, reviewsAny: 0 };
  if (!(await orgRefsReadable(tx))) return none;
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
