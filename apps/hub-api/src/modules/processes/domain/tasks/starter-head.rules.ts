// CR-139 · Q1 · kiểu người duyệt «Trưởng phòng của người đề xuất» (`after.approver_mode = 'starter_head'`). Luật thuần — bản SQL
// chạy thật ở `core/starter-head.sql.ts` (một câu CTE đệ quy lúc mở việc) PHẢI khớp `pickStarterHead`.
import type { SoleTargets } from "./delegation.rules";
import { soleStarterTargets } from "./delegation.rules";

/** Mã khi không tìm được trưởng phòng nào (khác người gửi, còn dùng được) từ phòng của người gửi lên tới gốc. */
export const STARTER_HEAD_MISSING = "STARTER_HEAD_MISSING" as const;

/** Trần số bậc leo cây phòng ban (lưới an toàn khi dữ liệu có vòng). */
export const STARTER_HEAD_MAX_DEPTH = 32;

export function isStarterHead(after: { kind?: string; approver_mode?: string } | null | undefined) {
  return after?.kind === "review" && after.approver_mode === "starter_head";
}

export type Dept = { parent: string | null; head: string | null };

/**
 * Người duyệt = trưởng phòng GẦN NHẤT tính từ mọi phòng người gửi là thành viên, leo `parent_group_id`: bỏ phòng không có trưởng,
 * trưởng chính là người gửi, trưởng không còn dùng được (`usable` = cùng tenant, active, không khoá). Nhiều ứng viên cùng bậc ⇒
 * `group_id` nhỏ nhất (xác định). Không ai tới gốc ⇒ null (`STARTER_HEAD_MISSING`).
 */
export function pickStarterHead(
  depts: ReadonlyMap<string, Dept>,
  memberOf: readonly string[],
  starter: string,
  usable: (userId: string) => boolean,
): string | null {
  const best = new Map<string, number>(); // group_id → bậc nhỏ nhất
  let frontier = memberOf.filter((g) => depts.has(g));
  for (let depth = 0; frontier.length > 0 && depth <= STARTER_HEAD_MAX_DEPTH; depth++) {
    const next: string[] = [];
    for (const g of frontier) {
      if (best.has(g)) continue;
      best.set(g, depth);
      const p = depts.get(g)?.parent ?? null;
      if (p !== null && depts.has(p)) next.push(p);
    }
    frontier = next;
  }
  const cands = [...best.entries()]
    .map(([g, depth]) => ({ g, depth, head: depts.get(g)?.head ?? null }))
    .filter((c): c is { g: string; depth: number; head: string } => c.head !== null)
    .filter((c) => c.head !== starter && usable(c.head))
    .sort((a, b) => a.depth - b.depth || (a.g < b.g ? -1 : a.g > b.g ? 1 : 0));
  return cands[0]?.head ?? null;
}

/**
 * Không tìm được trưởng phòng ⇒ việc KHÔNG treo: giao như R#15 (người gửi là người duyệt duy nhất) — đích «Quá hạn chuyển cho»
 * (người ≠ người gửi / phòng) rồi quản trị công ty (trừ người gửi). Không còn ai ⇒ null.
 */
export function starterHeadFallback(
  starter: string | null,
  esc: { userId: string | null; groupId: string | null; adminIds: readonly string[] },
): SoleTargets | null {
  return soleStarterTargets({ gate: starter, soleUser: null, starter }, esc);
}
