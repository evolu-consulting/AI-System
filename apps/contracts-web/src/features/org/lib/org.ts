// M1D-FR-02 · luật thuần màn cơ cấu: ứng viên cấp quản lý của một người = mọi thành viên trừ chính họ và cấp dưới mọi tầng
// (chọn cấp dưới làm quản lý = vòng; DB cũng chặn — `user_managers_cycle_ck`).
import type { OrgMember } from "@ai/contracts";

/** Cấp dưới mọi tầng của `userId` (không gồm chính họ); chịu được dữ liệu có vòng. */
export function reportsOf(members: readonly OrgMember[], userId: string): Set<string> {
  const under = new Map<string, string[]>();
  for (const m of members) {
    if (!m.manager_id) continue;
    const list = under.get(m.manager_id) ?? [];
    list.push(m.user_id);
    under.set(m.manager_id, list);
  }
  const out = new Set<string>();
  const todo = [userId];
  while (todo.length) {
    for (const r of under.get(todo.pop() as string) ?? []) {
      if (r !== userId && !out.has(r)) {
        out.add(r);
        todo.push(r);
      }
    }
  }
  return out;
}

export function managerOptions(members: readonly OrgMember[], userId: string): OrgMember[] {
  const banned = reportsOf(members, userId);
  return members.filter((m) => m.user_id !== userId && !banned.has(m.user_id));
}
