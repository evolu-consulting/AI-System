// M1D-FR-02 · luật thuần màn cơ cấu: ứng viên cấp quản lý của một người = mọi thành viên trừ chính họ và cấp dưới mọi tầng
// (chọn cấp dưới làm quản lý = vòng; DB cũng chặn — `user_managers_cycle_ck`).
import type { OrgDepartment, OrgMember, OrgResponse } from "@ai/contracts/org";

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

// CR-189 BR-189-5: cấp quản lý CHỈ là trưởng phòng. Ô chọn liệt kê trưởng phòng, gợi ý sẵn trưởng phòng của phòng người đó;
// người đang có cấp quản lý không phải trưởng phòng giữ nguyên (cảnh báo vàng, không tự xoá).

export function headIdsOf(departments: readonly OrgDepartment[]): Set<string> {
  return new Set(departments.flatMap((d) => (d.head_user_id ? [d.head_user_id] : [])));
}

/** Trưởng phòng của phòng người này (khác chính họ); không có ⇒ null. */
export function suggestedHeadOf(
  departments: readonly OrgDepartment[],
  userId: string,
): string | null {
  for (const d of departments)
    if (d.head_user_id && d.head_user_id !== userId && d.member_ids.includes(userId))
      return d.head_user_id;
  return null;
}

/** Cảnh báo vàng: có cấp quản lý nhưng người đó không phải trưởng phòng. */
export function managerNotHead(org: OrgResponse, managerId: string | null): boolean {
  return managerId !== null && !headIdsOf(org.departments).has(managerId);
}

/** Ứng viên cấp quản lý: trưởng phòng, trừ chính họ và cấp dưới (tránh vòng); gợi ý đứng đầu; `q` lọc theo tên. */
export function headCandidates(
  org: OrgResponse,
  userId: string,
  q: string,
): { id: string; name: string }[] {
  const heads = headIdsOf(org.departments);
  const banned = reportsOf(org.members, userId);
  const sug = suggestedHeadOf(org.departments, userId);
  const needle = q.trim().toLocaleLowerCase("vi");
  return org.members
    .filter(
      (m) =>
        heads.has(m.user_id) &&
        m.user_id !== userId &&
        !banned.has(m.user_id) &&
        (!needle || m.display_name.toLocaleLowerCase("vi").includes(needle)),
    )
    .map((m) => ({ id: m.user_id, name: m.display_name }))
    .sort((a, b) => Number(b.id === sug) - Number(a.id === sug));
}
