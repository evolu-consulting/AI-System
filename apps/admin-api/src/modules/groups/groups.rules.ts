// ADM-FR-62, ADM-FR-55 · luật groups dạng hàm thuần (plan M3 §4; M3-R01…R05). Không import I/O.
import { BETA_GROUP_KEY, type ErrorCode, USERNAME_RE } from "@ai/contracts";

export { BETA_GROUP_KEY };
export type RuleError = { code: ErrorCode; details?: unknown };

export function isBetaGroup(g: { key: string }): boolean {
  return g.key === BETA_GROUP_KEY;
}

/** `beta-testers` không xoá được (M3-R02); đổi key không có đường (PATCH không nhận `key`). */
export function checkGroupDelete(g: { key: string }): RuleError | null {
  return isBetaGroup(g) ? { code: "BETA_GROUP_PROTECTED" } : null;
}

export type GroupState = { name: { vi: string; en?: string }; description: string | null };

/** Trường thực sự đổi; `name` so theo giá trị (không theo thứ tự khoá). [] → không ghi, không tăng version. */
export function changedGroupFields(cur: GroupState, next: GroupState): (keyof GroupState)[] {
  const out: (keyof GroupState)[] = [];
  if (cur.name.vi !== next.name.vi || cur.name.en !== next.name.en) out.push("name");
  if (cur.description !== next.description) out.push("description");
  return out;
}

export type FoundUser = { username: string; id: string };
export type MemberPlan = {
  toInsert: string[];
  added: string[];
  not_found: string[];
  already: string[];
};

/**
 * input: username đã chuẩn hoá, không trùng. found: user CÙNG tenant khớp username. existing: id đã là thành viên.
 * added/already/not_found theo thứ tự input (sai USERNAME_RE → not_found). toInsert = id của added, sắp tăng (khoá §6).
 */
export function planMemberAdd(
  input: readonly string[],
  found: readonly FoundUser[],
  existing: ReadonlySet<string>,
): MemberPlan {
  const byName = new Map(found.map((f) => [f.username, f.id]));
  const plan: MemberPlan = { toInsert: [], added: [], not_found: [], already: [] };
  for (const name of input) {
    const id = USERNAME_RE.test(name) ? byName.get(name) : undefined;
    if (id === undefined) plan.not_found.push(name);
    else if (existing.has(id)) plan.already.push(name);
    else {
      plan.added.push(name);
      plan.toInsert.push(id);
    }
  }
  plan.toInsert.sort();
  return plan;
}
