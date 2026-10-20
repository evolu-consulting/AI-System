// niti-onboard · onboarding tenant chạy lại được: (1) một tx `configWrite`: tạo/cập nhật tenant (tên, múi giờ, hồ sơ, marker
// importer) + Group phòng ban (vi/en) + cây phòng ban + thành viên/trưởng phòng theo email; (2) mỗi gói: `enablePack` (PK-FR-05,
// cùng đường admin-web — entitlement + 3 Group vai + grant + trợ lý gói `packs.grant_agents`). Không đổi ⇒ không ghi, không audit.
import type { Db, Tx } from "@ai/db";
import { auditOf } from "../../../lib/audit/audit.write";
import { type ConfigSink, configWrite } from "../../../lib/config/config-write";
import { appError } from "../../../lib/errors";
import { enablePack } from "../../packs/packs.service";
import { NEW_TENANT_SETTINGS } from "../../tenants/tenants.service";
import * as repo from "../adapters/onboard.repo";
import {
  bindDecision,
  deptRows,
  memberPairs,
  type OnboardSpec,
  sameJson,
} from "../domain/onboard.rules";

const PLATFORM = { kind: "platform" } as const;

export type OnboardReport = {
  tenant: { id: string; key: string; created: boolean; updated: boolean };
  binding: { source: string; org_id: string; state: "set" | "kept" } | null;
  departments: { total: number; groups_created: number; groups_renamed: number; changed: number };
  members: { added: number; heads_set: number; pending_emails: string[] };
  packs: { key: string; groups: number }[];
};

type Step = { tid: string; created: boolean; updated: boolean; binding: OnboardReport["binding"] };

/** Marker importer: lỗi khi gắn lại org khác (ORG_REBIND) hoặc org đã thuộc tenant khác (ORG_TAKEN). */
async function bindingOf(tx: Tx, s: OnboardSpec, cur: repo.TenantNow | null) {
  const want = s.import?.org_id ? { source: s.import.source, orgId: s.import.org_id } : null;
  const d = bindDecision(want, { source: cur?.src ?? null, orgId: cur?.org ?? null });
  if (d.kind === "error") throw appError("VALIDATION_ERROR", { reason: d.code });
  if (d.kind === "set" && (await repo.orgTakenBy(tx, d.b.orgId, cur?.id ?? null)))
    throw appError("VALIDATION_ERROR", { reason: "ORG_TAKEN" });
  const mark: Record<string, string> =
    d.kind === "set" ? { mgmt_source: d.b.source, mgmt_org_id: d.b.orgId } : {};
  const binding: Step["binding"] = want
    ? { source: want.source, org_id: want.orgId, state: d.kind === "set" ? "set" : "kept" }
    : null;
  return { mark, binding, setting: d.kind === "set" };
}

/** Tenant: tạo (settings mặc định tenant mới + marker) hoặc ghi khi tên/múi giờ/hồ sơ/marker đổi. */
async function tenantStep(tx: Tx, s: OnboardSpec, actorId: string): Promise<Step> {
  const cur = await repo.lockTenant(tx, s.key);
  const { mark, binding, setting } = await bindingOf(tx, s, cur);
  if (!cur) {
    const id = Bun.randomUUIDv7();
    const settings = { ...NEW_TENANT_SETTINGS, ...mark };
    const t = { id, key: s.key, name: s.name, timezone: s.timezone, profile: s.profile, settings };
    if (!(await repo.insertTenant(tx, t, actorId))) throw appError("KEY_TAKEN");
    return { tid: id, created: true, updated: false, binding };
  }
  const same =
    cur.name === s.name &&
    cur.timezone === s.timezone &&
    sameJson(cur.profile, s.profile) &&
    !setting;
  if (!same) {
    const set = { name: s.name, timezone: s.timezone, profile: s.profile, mark };
    await repo.updateTenant(tx, cur.id, set, actorId);
  }
  return { tid: cur.id, created: false, updated: !same, binding };
}

async function orgStep(tx: Tx, tid: string, s: OnboardSpec, actorId: string) {
  const { rows, issues } = deptRows(s);
  if (issues.length > 0) throw appError("VALIDATION_ERROR", { reason: "DEPARTMENTS", issues });
  const g = await repo.upsertGroups(tx, tid, rows, actorId);
  const changed = await repo.upsertDepartments(tx, tid, rows);
  const { members, heads } = memberPairs(s);
  const m = members.length > 0 ? await repo.addMembers(tx, tid, members, actorId) : null;
  const headsSet = heads.length > 0 ? await repo.setHeads(tx, tid, heads) : 0;
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

function record(ch: ConfigSink, s: OnboardSpec, st: Step, o: Awaited<ReturnType<typeof orgStep>>) {
  const d = o.departments;
  const groupsChanged =
    d.groups_created + d.groups_renamed + d.changed + o.members.added + o.members.heads_set > 0;
  if (st.created || st.updated) ch.changed({ entity: "tenant", tenantId: st.tid });
  if (groupsChanged) ch.changed({ entity: "group", tenantId: st.tid });
  if (!(st.created || st.updated || groupsChanged)) return;
  ch.audit(
    auditOf(st.created ? "create" : "update", "tenant", {
      entityId: st.tid,
      entityName: s.key,
      tenantId: st.tid,
      before: null,
      after: null,
      summary: { op: "tenant.onboard", binding: st.binding, ...o.departments, ...o.members },
    }),
  );
}

export async function onboardTenant(
  db: Db,
  s: OnboardSpec,
  actorId: string,
): Promise<OnboardReport> {
  const call = { ctx: { db }, scope: PLATFORM, actor: { userId: actorId } };
  const first = await configWrite(call, "tenant.save", async (tx, ch) => {
    if (!(await repo.actorOk(tx, actorId))) throw appError("FORBIDDEN");
    const st = await tenantStep(tx, s, actorId);
    const o = await orgStep(tx, st.tid, s, actorId);
    record(ch, s, st, o);
    return { st, o };
  });
  const packs: OnboardReport["packs"] = [];
  for (const k of s.packs) {
    const p = await enablePack(call, first.st.tid, k);
    packs.push({ key: k, groups: p.groups.length });
  }
  const { st, o } = first;
  return {
    tenant: { id: st.tid, key: s.key, created: st.created, updated: st.updated },
    binding: st.binding,
    ...o,
    packs,
  };
}
