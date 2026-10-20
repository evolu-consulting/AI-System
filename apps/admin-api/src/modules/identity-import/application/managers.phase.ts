// M1D-FR-02 · docs/specs/M1b-visibility · pha quản lý của công cụ chuyển user: `manager_email` ⇒ `admin.user_managers`, theo lô
// tenant (mỗi lô MỘT tx: 1 câu đọc + 1 câu chèn — N5-NFR-01), cấm vòng ở domain trước khi ghi (trigger DB vẫn là chốt cuối:
// vi phạm ⇒ hỏng MỘT lô, BATCH_FAILED). Chạy sau pha user (user mới đã có id). Dry-run: user sẽ tạo tính như đã có.
import type { ImportReport, Issue, ManagerWant, OrgUser } from "../domain/import";
import { normEmail, validEmail } from "../domain/import.rules";
import { planManagers, tenantBatches } from "../domain/managers.rules";
import type { ErrorClass, ImportStore, ManagerSet, TenantUser } from "./ports";

export type ManagerRun = {
  report: ImportReport;
  tenantOf: ReadonlyMap<string, string | null>;
  keyOf: ReadonlyMap<string, string>;
};
type Deps = {
  store: ImportStore;
  constraintError: ErrorClass;
  onBatch?: (kind: "manager", i: number) => void;
};
type Plan = { sets: ManagerSet[]; planned: number; existing: number; issues: Issue[] };

function wantsByTenant(
  r: ManagerRun,
  users: readonly { email: string; orgId: string | null; managerEmail?: string | null }[],
) {
  const by = new Map<string, ManagerWant[]>();
  for (const u of users) {
    const m = normEmail(u.managerEmail ?? "");
    if (!m) continue;
    r.report.managers.read++;
    const tid = u.orgId === null ? null : r.tenantOf.get(u.orgId);
    const email = normEmail(u.email);
    // M1c (review A-13): chỉ email hợp lệ — khoá nội bộ `#<uuid>` (user không email) không được nhắm tới từ file.
    if (!tid || !validEmail(email)) continue;
    if (!validEmail(m)) {
      r.report.issues.push({ kind: "manager", ref: email, code: "MANAGER_UNKNOWN" });
      continue;
    }
    const list = by.get(tid) ?? [];
    list.push({ email, managerEmail: m });
    by.set(tid, list);
  }
  return by;
}

/** User DB (khoá email thường, không email ⇒ `#id`) + user sẽ tạo của lần chạy (dry-run, id null). */
function orgUsers(rows: TenantUser[], planned: readonly string[]): OrgUser[] {
  const keyOf = new Map(rows.map((u) => [u.id, u.email ? u.email.toLowerCase() : `#${u.id}`]));
  const out: OrgUser[] = rows.map((u) => ({
    key: keyOf.get(u.id) as string,
    id: u.id,
    managerKey: u.managerId === null ? null : (keyOf.get(u.managerId) ?? `#${u.managerId}`),
  }));
  const have = new Set(out.map((u) => u.key));
  for (const e of planned) if (!have.has(e)) out.push({ key: e, id: null, managerKey: null });
  return out;
}

function decider(r: ManagerRun, tids: string[], by: ReadonlyMap<string, ManagerWant[]>) {
  return (rows: TenantUser[]): Plan => {
    const plan: Plan = { sets: [], planned: 0, existing: 0, issues: [] };
    for (const tid of tids) {
      const key = r.keyOf.get(tid);
      const planned = r.report.accounts.filter((a) => a.tenant_key === key).map((a) => a.email);
      const users = orgUsers(
        rows.filter((u) => u.tenantId === tid),
        planned,
      );
      const idOf = new Map(users.map((u) => [u.key, u.id]));
      const p = planManagers(by.get(tid) ?? [], users);
      plan.existing += p.existing;
      plan.issues.push(...p.issues);
      for (const s of p.sets) {
        plan.planned++;
        const userId = idOf.get(s.userKey);
        const managerId = idOf.get(s.managerKey);
        if (userId && managerId) plan.sets.push({ tenantId: tid, userId, managerId });
      }
    }
    return plan;
  };
}

export async function managerPhase(
  r: ManagerRun,
  users: readonly { email: string; orgId: string | null; managerEmail?: string | null }[],
  o: { apply: boolean; batch: number },
  d: Deps,
): Promise<void> {
  const by = wantsByTenant(r, users);
  for (const tids of tenantBatches(by, o.batch)) {
    await managerBatch(r, tids, by, o.apply, d);
    r.report.batches++;
    d.onBatch?.("manager", r.report.batches);
  }
  r.report.managers.errors = r.report.issues.filter((i) => i.kind === "manager").length;
}

async function managerBatch(
  r: ManagerRun,
  tids: string[],
  by: ReadonlyMap<string, ManagerWant[]>,
  apply: boolean,
  d: Deps,
): Promise<void> {
  const m = r.report.managers;
  const real = tids.filter((t) => !t.startsWith("new:"));
  try {
    const res = await d.store.managerBatch(apply, real, decider(r, tids, by));
    const done = apply ? res.written : res.plan.planned;
    m.set += done;
    m.existing += res.plan.existing + (res.plan.planned - done);
    r.report.issues.push(...res.plan.issues);
  } catch (err) {
    if (d.constraintError(err) === null) throw err;
    for (const t of tids)
      for (const w of by.get(t) ?? [])
        r.report.issues.push({ kind: "manager", ref: w.email, code: "BATCH_FAILED" });
  }
}
