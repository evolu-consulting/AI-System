// M1D-FR-02 · docs/specs/M1b-visibility · luật thuần nhập `manager_email` của mgmt-app vào `admin.user_managers` (như
// orgs._check_manager): một quản lý mỗi user, cùng tenant, cấm vòng (kể cả tự quản lý). User đã có quản lý ⇒ không đè (L2:
// chạy lại không hoàn tác việc admin đổi tay). Duyệt theo thứ tự file; cạnh nhận trước được ưu tiên. Chỉ built-in.
import type { Issue, ManagerPlan, ManagerWant, OrgUser } from "./import";

/** `mgr` nằm dưới `user` (hoặc chính nó) trong cây hiện tại ⇒ đặt `user → mgr` tạo vòng. O(độ sâu). */
function closesCycle(parent: ReadonlyMap<string, string>, user: string, mgr: string): boolean {
  let x: string | undefined = mgr;
  for (let i = 0; x !== undefined && i <= parent.size; i++) {
    if (x === user) return true;
    x = parent.get(x);
  }
  return x !== undefined; // dữ liệu có sẵn đã vòng (không thể qua trigger DB) ⇒ coi là vòng
}

/** Kế hoạch cho MỘT tenant: `users` = mọi user của tenant (DB + sẽ tạo), `wants` = cặp (user, quản lý) đã chuẩn hoá. */
export function planManagers(
  wants: readonly ManagerWant[],
  users: readonly OrgUser[],
): ManagerPlan {
  const known = new Set(users.map((u) => u.key));
  const parent = new Map<string, string>();
  for (const u of users) if (u.managerKey !== null) parent.set(u.key, u.managerKey);
  const plan: ManagerPlan = { sets: [], existing: 0, issues: [] };
  const issue = (ref: string, code: Issue["code"]) =>
    plan.issues.push({ kind: "manager", ref, code });
  for (const w of wants) {
    if (!known.has(w.email)) continue; // user không được tạo/không có ⇒ đã có lỗi riêng ở pha user
    if (parent.has(w.email)) {
      plan.existing++;
      continue;
    }
    if (!known.has(w.managerEmail)) {
      issue(w.email, "MANAGER_UNKNOWN");
      continue;
    }
    if (closesCycle(parent, w.email, w.managerEmail)) {
      issue(w.email, "MANAGER_CYCLE");
      continue;
    }
    parent.set(w.email, w.managerEmail);
    plan.sets.push({ userKey: w.email, managerKey: w.managerEmail });
  }
  return plan;
}

/** Gom tenant thành lô: tổng cặp mỗi lô ≤ `n` (một tenant không bị tách — kiểm vòng cần cả cây của tenant). */
export function tenantBatches<T>(
  byTenant: ReadonlyMap<string, readonly T[]>,
  n: number,
): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const [tid, xs] of byTenant) {
    if (cur.length > 0 && size + xs.length > n) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(tid);
    size += xs.length;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}
