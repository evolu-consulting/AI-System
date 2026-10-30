// CR-105 · L1 · design §1/§8: luật id ↔ mã Group của def. Def thư viện (`tenant_id NULL` + `slot`) trỏ Group CHỈ bằng mã (`*_key`):
// id Group thuộc một tenant ⇒ không được nằm trong def dùng chung (rò id A sang B). Def tenant CHỈ bằng id (mã chưa phân giải ⇒
// engine không chạy được). Vi phạm đầu tiên ⇒ `PROCESS_REF_INVALID` (ref "group"). Thuần.
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import type { RefMiss } from "./def-refs";

type Stage = ProcessDefInput["stages"][number];
type Kind = "id" | "key";
type Ref = { path: string; kind: Kind };

const one = (path: string, kind: Kind, v: unknown): Ref[] =>
  v === null || v === undefined ? [] : [{ path, kind }];
const many = (path: string, kind: Kind, vs: readonly unknown[] | undefined): Ref[] =>
  (vs ?? []).map((_, j) => ({ path: `${path}.${j}`, kind }));

/** Mọi chỗ trỏ Group của một stage, theo thứ tự kiểm (Group duyệt → cũng quyết → chuyển cấp → người trả lời). */
function stageGroupRefs(s: Stage): Ref[] {
  const a = s.after;
  const r = s.answerer.kind === "group" ? s.answerer : null;
  const review =
    a.kind === "review"
      ? [
          ...one("after.group_id", "id", a.group_id),
          ...one("after.group_key", "key", a.group_key),
          ...many("after.also_group_ids", "id", a.also_group_ids),
          ...many("after.also_group_keys", "key", a.also_group_keys),
          ...one("after.escalate.group_id", "id", a.escalate?.group_id),
          ...one("after.escalate.group_key", "key", a.escalate?.group_key),
        ]
      : [];
  return [
    ...review,
    ...one("answerer.group_id", "id", r?.group_id),
    ...one("answerer.group_key", "key", r?.group_key),
  ];
}

/** Chỗ trỏ Group sai kiểu đầu tiên: `library` ⇒ cấm id; ngược lại ⇒ cấm mã. Null nếu hợp lệ. */
export function groupRefModeMiss(d: ProcessDefInput, library: boolean): RefMiss | null {
  const bad: "id" | "key" = library ? "id" : "key";
  for (const [i, s] of d.stages.entries()) {
    const r = stageGroupRefs(s).find((x) => x.kind === bad);
    if (r) return { path: `stages.${i}.${r.path}`, ref: "group" };
  }
  if (library && d.run_group_ids.length > 0) return { path: "run_group_ids.0", ref: "group" };
  if (!library && (d.run_group_keys ?? []).length > 0)
    return { path: "run_group_keys.0", ref: "group" };
  return null;
}

/** Stage review đã có Group duyệt (id hoặc mã tuỳ loại def) — luật INCOMPLETE khi bật. */
export function reviewHasGroup(s: Stage, library: boolean): boolean {
  if (s.after.kind !== "review") return true;
  return library ? s.after.group_key !== undefined : s.after.group_id !== null;
}
