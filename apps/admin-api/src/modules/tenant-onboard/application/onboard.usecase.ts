// niti-onboard · onboarding tenant chạy lại được: (1) một tx `write`: tạo/cập nhật tenant (tên, múi giờ, hồ sơ, marker
// importer) + Group phòng ban (vi/en) + cây phòng ban + thành viên/trưởng phòng theo email; (2) mỗi gói: `enablePack` (PK-FR-05,
// cùng đường admin-web — entitlement + 3 Group vai + grant + trợ lý gói `packs.grant_agents`). Không đổi ⇒ không ghi, không audit.
// CR-159: thứ tự = đọc người dùng (chỉ đọc, kiểm `--pw-out`) → tx tenant → người dùng (usecase users.service) → gói → add-on → tx phòng ban
// (trưởng/thành viên) — người dùng có TRƯỚC phòng ban nên không còn `pending`; gói sau người dùng nên quản trị mới thành Chủ gói.
import {
  bindDecision,
  deptRows,
  memberPairs,
  type OnboardSpec,
  planUsers,
  profileSame,
  roleOf,
  usernameOf,
} from "../domain/onboard.rules";
import type { OnboardPorts, OnboardRepo, OnboardSink, TenantNow } from "./ports";

export type OnboardReport = {
  tenant: { id: string; key: string; created: boolean; updated: boolean };
  binding: { source: string; org_id: string; state: "set" | "kept" } | null;
  departments: { total: number; groups_created: number; groups_renamed: number; changed: number };
  members: { added: number; heads_set: number; pending_emails: string[] };
  packs: { key: string; groups: number }[];
  /** CR-159 · chỉ số đếm + email vừa tạo; KHÔNG bao giờ có mật khẩu. */
  users: { created: number; updated: number; unchanged: number; created_emails: string[] };
  addons: { key: string; granted: boolean }[];
};

type Step = { tid: string; created: boolean; updated: boolean; binding: OnboardReport["binding"] };

/** Marker importer: lỗi khi gắn lại org khác (ORG_REBIND) hoặc org đã thuộc tenant khác (ORG_TAKEN). */
async function bindingOf(
  p: OnboardPorts,
  repo: OnboardRepo,
  s: OnboardSpec,
  cur: TenantNow | null,
) {
  const want = s.import?.org_id ? { source: s.import.source, orgId: s.import.org_id } : null;
  const d = bindDecision(want, { source: cur?.src ?? null, orgId: cur?.org ?? null });
  if (d.kind === "error") throw p.fail("VALIDATION_ERROR", { reason: d.code });
  if (d.kind === "set" && (await repo.orgTakenBy(d.b.orgId, cur?.id ?? null)))
    throw p.fail("VALIDATION_ERROR", { reason: "ORG_TAKEN" });
  const mark: Record<string, string> =
    d.kind === "set" ? { mgmt_source: d.b.source, mgmt_org_id: d.b.orgId } : {};
  const binding: Step["binding"] = want
    ? { source: want.source, org_id: want.orgId, state: d.kind === "set" ? "set" : "kept" }
    : null;
  return { mark, binding, setting: d.kind === "set" };
}

/** Tenant: tạo (settings mặc định tenant mới + marker) hoặc ghi khi tên/múi giờ/hồ sơ/marker đổi. */
async function tenantStep(
  p: OnboardPorts,
  repo: OnboardRepo,
  s: OnboardSpec,
  actorId: string,
): Promise<Step> {
  const cur = await repo.lockTenant(s.key);
  const { mark, binding, setting } = await bindingOf(p, repo, s, cur);
  if (!cur) {
    const id = Bun.randomUUIDv7();
    const settings = { ...p.newTenantSettings, ...mark };
    const t = { id, key: s.key, name: s.name, timezone: s.timezone, profile: s.profile, settings };
    if (!(await repo.insertTenant(t, actorId))) throw p.fail("KEY_TAKEN");
    return { tid: id, created: true, updated: false, binding };
  }
  const same =
    cur.name === s.name &&
    cur.timezone === s.timezone &&
    profileSame(cur.profile, s.profile) &&
    !setting;
  if (!same) {
    const set = { name: s.name, timezone: s.timezone, profile: s.profile, mark };
    await repo.updateTenant(cur.id, set, actorId);
  }
  return { tid: cur.id, created: false, updated: !same, binding };
}

async function orgStep(
  c: { p: OnboardPorts; repo: OnboardRepo },
  tid: string,
  s: OnboardSpec,
  actorId: string,
) {
  const { p, repo } = c;
  const { rows, issues } = deptRows(s);
  if (issues.length > 0) throw p.fail("VALIDATION_ERROR", { reason: "DEPARTMENTS", issues });
  const g = await repo.upsertGroups(tid, rows, actorId);
  const changed = await repo.upsertDepartments(tid, rows);
  const { members, heads } = memberPairs(s);
  const m = members.length > 0 ? await repo.addMembers(tid, members, actorId) : null;
  const headsSet = heads.length > 0 ? await repo.setHeads(tid, heads) : 0;
  return {
    departments: {
      total: rows.length,
      groups_created: g.created,
      groups_renamed: g.renamed,
      changed,
    },
    members: { added: m?.added ?? 0, heads_set: headsSet, pending_emails: m?.pending ?? [] },
  };
}

function recordTenant(ch: OnboardSink, s: OnboardSpec, st: Step) {
  if (!(st.created || st.updated)) return;
  ch.changed("tenant", st.tid);
  ch.audit({
    op: st.created ? "create" : "update",
    entityId: st.tid,
    entityName: s.key,
    tenantId: st.tid,
    summary: { op: "tenant.onboard", binding: st.binding },
  });
}

function recordOrg(
  ch: OnboardSink,
  s: OnboardSpec,
  st: Step,
  o: Awaited<ReturnType<typeof orgStep>>,
) {
  const d = o.departments;
  const changed =
    d.groups_created + d.groups_renamed + d.changed + o.members.added + o.members.heads_set > 0;
  if (!changed) return;
  ch.changed("group", st.tid);
  ch.audit({
    op: "update",
    entityId: st.tid,
    entityName: s.key,
    tenantId: st.tid,
    summary: { op: "tenant.onboard.org", ...o.departments, ...o.members },
  });
}

type UserPlan = ReturnType<typeof planUsers>;

/** Người dùng: tạo mới (mật khẩu tạm ghi file ngay khi sinh) rồi cập nhật tên/vai/chức vụ; không đổi mật khẩu người đã có. */
async function usersStep(p: OnboardPorts, tid: string, plan: UserPlan) {
  for (const u of plan.create) {
    const r = await p.createUser(tid, {
      username: usernameOf(u.email),
      display_name: u.name,
      email: u.email,
      role: roleOf(u.role),
    });
    // savePassword đã được kiểm có mặt ở bước đọc; ghi ngay để lỗi sau đó không làm mất mật khẩu.
    await (p.savePassword as NonNullable<typeof p.savePassword>)(u.email, r.tempPassword);
    await p.setJobTitle(tid, r.id, u.title);
  }
  for (const u of plan.update) {
    if (Object.keys(u.set).length > 0) await p.updateUser(u.id, u.version, u.set);
    if (u.title !== undefined) await p.setJobTitle(tid, u.id, u.title);
  }
  return {
    created: plan.create.length,
    updated: plan.update.length,
    unchanged: plan.unchanged,
    created_emails: plan.create.map((u) => u.email),
  };
}

/** Chỉ đọc, trước mọi câu ghi: phòng ban hợp lệ; có người dùng mới mà thiếu nơi ghi mật khẩu ⇒ dừng. */
async function precheck(p: OnboardPorts, s: OnboardSpec): Promise<UserPlan> {
  const { issues } = deptRows(s);
  if (issues.length > 0) throw p.fail("VALIDATION_ERROR", { reason: "DEPARTMENTS", issues });
  for (const k of s.addons)
    if (!(await p.addonKnown(k)))
      throw p.fail("VALIDATION_ERROR", { reason: "ADDON_UNKNOWN", addon: k });
  const now = await p.readUsers(
    s.key,
    s.users.map((u) => u.email),
  );
  const plan = planUsers(s.users, now);
  if (plan.create.length > 0 && !p.savePassword)
    throw p.fail("VALIDATION_ERROR", { reason: "PW_OUT_REQUIRED", new_users: plan.create.length });
  if (plan.create.length > 0 && p.probeSink) {
    try {
      await p.probeSink();
    } catch {
      throw p.fail("VALIDATION_ERROR", { reason: "PW_OUT_NOT_WRITABLE" });
    }
  }
  return plan;
}

export async function onboardTenant(
  p: OnboardPorts,
  s: OnboardSpec,
  actorId: string,
): Promise<OnboardReport> {
  const plan = await precheck(p, s);
  const st = await p.write(async (repo, ch) => {
    if (!(await repo.actorOk(actorId))) throw p.fail("FORBIDDEN");
    const t = await tenantStep(p, repo, s, actorId);
    recordTenant(ch, s, t);
    return t;
  });
  const users = await usersStep(p, st.tid, plan);
  const packs: OnboardReport["packs"] = [];
  for (const k of s.packs) packs.push({ key: k, groups: (await p.enablePack(st.tid, k)).groups });
  const addons: OnboardReport["addons"] = [];
  for (const k of s.addons) addons.push({ key: k, granted: await p.grantAddon(st.tid, k) });
  const o = await p.write(async (repo, ch) => {
    const r = await orgStep({ p, repo }, st.tid, s, actorId);
    recordOrg(ch, s, st, r);
    return r;
  });
  return {
    tenant: { id: st.tid, key: s.key, created: st.created, updated: st.updated },
    binding: st.binding,
    ...o,
    packs,
    users,
    addons,
  };
}
