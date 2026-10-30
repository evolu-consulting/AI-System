// niti-onboard · onboarding tenant chạy lại được: (1) một tx `write`: tạo/cập nhật tenant (tên, múi giờ, hồ sơ, marker
// importer) + Group phòng ban (vi/en) + cây phòng ban + thành viên/trưởng phòng theo email; (2) mỗi gói: `enablePack` (PK-FR-05,
// cùng đường admin-web — entitlement + 3 Group vai + grant + trợ lý gói `packs.grant_agents`). Không đổi ⇒ không ghi, không audit.
import {
  bindDecision,
  deptRows,
  memberPairs,
  type OnboardSpec,
  sameJson,
} from "../domain/onboard.rules";
import type { OnboardPorts, OnboardRepo, OnboardSink, TenantNow } from "./ports";

export type OnboardReport = {
  tenant: { id: string; key: string; created: boolean; updated: boolean };
  binding: { source: string; org_id: string; state: "set" | "kept" } | null;
  departments: { total: number; groups_created: number; groups_renamed: number; changed: number };
  members: { added: number; heads_set: number; pending_emails: string[] };
  packs: { key: string; groups: number }[];
  /** CR-105 L5: null => yaml has no `approval_process`. An error is only reported here; the tenant is still created. */
  approval: {
    process: string;
    slot: string;
    state: "assigned" | "error";
    error?: string;
  } | null;
};

export const APPROVAL_SLOT = "contracts.approval";

async function approvalStep(
  p: OnboardPorts,
  tid: string,
  s: OnboardSpec,
  contractsOn: boolean,
): Promise<OnboardReport["approval"]> {
  if (!s.approval_process) return null;
  const base = { process: s.approval_process, slot: APPROVAL_SLOT };
  const err = (error: string) => ({ ...base, state: "error" as const, error });
  if (!contractsOn) return err("PACK_CONTRACTS_NOT_ENABLED");
  if (!p.processAssign) return err("ASSIGN_NOT_CONFIGURED");
  try {
    const r = await p.processAssign.assign(tid, APPROVAL_SLOT, s.approval_process);
    return r.ok ? { ...base, state: "assigned" } : err(r.code);
  } catch {
    return err("ASSIGN_FAILED");
  }
}

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
    sameJson(cur.profile, s.profile) &&
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

function record(ch: OnboardSink, s: OnboardSpec, st: Step, o: Awaited<ReturnType<typeof orgStep>>) {
  const d = o.departments;
  const groupsChanged =
    d.groups_created + d.groups_renamed + d.changed + o.members.added + o.members.heads_set > 0;
  if (st.created || st.updated) ch.changed("tenant", st.tid);
  if (groupsChanged) ch.changed("group", st.tid);
  if (!(st.created || st.updated || groupsChanged)) return;
  ch.audit({
    op: st.created ? "create" : "update",
    entityId: st.tid,
    entityName: s.key,
    tenantId: st.tid,
    summary: { op: "tenant.onboard", binding: st.binding, ...o.departments, ...o.members },
  });
}

export async function onboardTenant(
  p: OnboardPorts,
  s: OnboardSpec,
  actorId: string,
): Promise<OnboardReport> {
  const first = await p.write(async (repo, ch) => {
    if (!(await repo.actorOk(actorId))) throw p.fail("FORBIDDEN");
    const st = await tenantStep(p, repo, s, actorId);
    const o = await orgStep({ p, repo }, st.tid, s, actorId);
    record(ch, s, st, o);
    return { st, o };
  });
  const packs: OnboardReport["packs"] = [];
  for (const k of s.packs) {
    const r = await p.enablePack(first.st.tid, k);
    packs.push({ key: k, groups: r.groups });
  }
  const approval = await approvalStep(
    p,
    first.st.tid,
    s,
    packs.some((x) => x.key === "contracts"),
  );
  const { st, o } = first;
  return {
    tenant: { id: st.tid, key: s.key, created: st.created, updated: st.updated },
    binding: st.binding,
    ...o,
    packs,
    approval,
  };
}
