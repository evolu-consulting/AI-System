// N5-FR-02, N5-FR-03, N5-FR-07 · cài port `ImportStore`: mỗi lô MỘT tx scope platform. Apply ⇒ `withConfigWrite` (bump +
// audit cùng tx khi có đổi, NOTIFY `config_changed` sau commit); dry-run ⇒ `withScope` chỉ câu đọc. Không log gì.
import { type ConfigSink, type Db, type Tx, withConfigWrite, withScope } from "@ai/db";
import { auditOf } from "../../../lib/audit/audit.write";
import { publishConfigChanged } from "../../../lib/config/config-write";
import {
  packFeatureKeys,
  packGroupKeys,
  roleGrantPairs,
  roleGroupRows,
} from "../../packs/packs.rules";
import type {
  GroupIds,
  ImportStore,
  OrgBatchResult,
  UserBatchResult,
  UserQuery,
} from "../application/ports";
import type { ExistingUser, OrgCreate, OrgPlan, PackRole, UserInsert } from "../domain/import";
import { isPackRole } from "../domain/import.rules";
import * as repo from "./import.repo";

export const PACK = "contracts";
const PLATFORM = { kind: "platform" } as const;
const FEATURES = packFeatureKeys(PACK);
const GROUP_KEYS = packGroupKeys(PACK);
const roleOfKey = (k: string): string => k.slice(PACK.length + 1);

export type StoreDeps = { db: Db; actorId: string; resetHash: string; newId: () => string };

/** Apply: tx có ghi ⇒ bump + audit; có sự kiện ⇒ NOTIFY một lần sau commit. */
async function write<T>(d: StoreDeps, fn: (tx: Tx, ch: ConfigSink) => Promise<T>): Promise<T> {
  const r = await withConfigWrite(d.db, PLATFORM, fn, { actorId: d.actorId });
  if (r.version !== null) await publishConfigChanged(d.db, r.version, r.events);
  return r.result;
}

async function packFor(d: StoreDeps, tx: Tx, ch: ConfigSink, tids: string[]): Promise<GroupIds> {
  if (tids.length === 0) return new Map();
  const ent = await repo.enableEntitlements(tx, tids, FEATURES, d.actorId);
  const grp = await repo.insertRoleGroups(tx, tids, roleGroupRows(PACK), d.actorId);
  const grants = await repo.insertRoleGrants(tx, tids, roleGrantPairs(PACK), d.actorId);
  const touched = new Set<string>();
  for (const [rows, entity] of [
    [ent, "entitlement"],
    [grp, "group"],
    [grants, "grant"],
  ] as const) {
    for (const r of rows) touched.add(r.tenant_id);
    for (const t of new Set(rows.map((r) => r.tenant_id))) ch.changed({ entity, tenantId: t });
  }
  for (const t of touched)
    ch.audit(
      auditOf("grant", "entitlement", {
        entityId: null,
        entityName: PACK,
        tenantId: t,
        before: null,
        after: { tenant_id: t },
        summary: { op: "pack.enable", pack: PACK, features: FEATURES, source: "identity-import" },
      }),
    );
  const out = new Map<string, Record<PackRole, string>>();
  for (const g of await repo.readGroups(tx, tids, GROUP_KEYS)) {
    const role = roleOfKey(g.key);
    if (!isPackRole(role)) continue;
    const m = out.get(g.tenant_id) ?? ({} as Record<PackRole, string>);
    m[role] = g.id;
    out.set(g.tenant_id, m);
  }
  return out;
}

async function createTenants(d: StoreDeps, tx: Tx, ch: ConfigSink, creates: OrgCreate[]) {
  if (creates.length === 0) return { created: [], lost: [] };
  const rows = creates.map((c) => ({ id: d.newId(), key: c.key, name: c.name, org_id: c.orgId }));
  const got = new Set((await repo.insertTenants(tx, rows, d.actorId)).map((r) => r.id));
  const created: OrgBatchResult["created"] = [];
  const lost: OrgCreate[] = [];
  for (const [i, r] of rows.entries()) {
    const c = creates[i] as OrgCreate;
    if (!got.has(r.id)) {
      lost.push(c);
      continue;
    }
    created.push({ orgId: c.orgId, tenantId: r.id, key: r.key });
    ch.changed({ entity: "tenant", tenantId: r.id });
    ch.audit(
      auditOf("create", "tenant", {
        entityId: r.id,
        entityName: r.key,
        tenantId: r.id,
        before: null,
        after: { key: r.key, name: r.name, active: true, version: 1 },
        summary: { op: "identity.import", source: "mgmt-app" },
      }),
    );
  }
  return { created, lost };
}

const toExistingTenants = (rows: repo.TenantRow[]) =>
  rows.map((t) => ({ id: t.id, key: t.key, mgmtOrgId: t.mgmt, active: t.active }));

async function orgBatch(
  d: StoreDeps,
  apply: boolean,
  q: { orgIds: string[]; keys: string[] },
  decide: (ex: ReturnType<typeof toExistingTenants>) => OrgPlan,
): Promise<OrgBatchResult> {
  if (!apply)
    return withScope(d.db, PLATFORM, async (tx) => {
      const plan = decide(toExistingTenants(await repo.findTenants(tx, q.orgIds, q.keys)));
      return { plan, created: [], lost: [], groups: new Map() };
    });
  return write(d, async (tx, ch) => {
    const plan = decide(toExistingTenants(await repo.findTenants(tx, q.orgIds, q.keys)));
    const { created, lost } = await createTenants(d, tx, ch, plan.creates);
    const tids = [...plan.reuse.map((r) => r.tenantId), ...created.map((c) => c.tenantId)];
    return { plan, created, lost, groups: await packFor(d, tx, ch, tids) };
  });
}

const toExistingUsers = (rows: repo.UserRow[]): ExistingUser[] =>
  rows.map((u) => ({
    tenantId: u.tenant_id,
    id: u.id,
    email: u.email ?? "",
    username: u.username,
    roles: u.roles.map(roleOfKey).filter(isPackRole),
  }));

function userAudit(x: UserInsert, id: string) {
  return auditOf("import", "user", {
    entityId: id,
    entityName: x.username,
    tenantId: x.tenantId,
    before: null,
    after: {
      username: x.username,
      display_name: x.displayName,
      email: x.email,
      role: x.role,
      locale: x.locale,
      active: true,
      must_change_password: x.password === "reset",
      version: 1,
    },
    summary: {
      op: "identity.import",
      source: "mgmt-app",
      reset_required: x.password === "reset",
      hash_imported: x.password === "import",
    },
  });
}

type Member = repo.NewMember & { audit?: ReturnType<typeof userAudit> };
/** Ngữ cảnh ghi của một lô (tx + sink sự kiện/audit). */
type W = { d: StoreDeps; tx: Tx; ch: ConfigSink };

async function writeUsers(w: W, plan: UserBatchResult["plan"], groups: GroupIds) {
  const { d, tx } = w;
  const ids = plan.inserts.map(() => d.newId());
  const rows: repo.NewUser[] = plan.inserts.map((x, i) => ({
    id: ids[i] as string,
    tenant_id: x.tenantId,
    username: x.username,
    email: x.email,
    hash: x.importedHash,
    display_name: x.displayName,
    role: x.role,
    locale: x.locale,
    must: x.password === "reset",
  }));
  const got = new Set(
    rows.length ? (await repo.insertUsers(tx, rows, d.resetHash, d.actorId)).map((r) => r.id) : [],
  );
  const inserted = plan.inserts.filter((_, i) => got.has(ids[i] as string));
  const gid = (t: string, r: PackRole) => groups.get(t)?.[r] as string;
  const members: Member[] = [
    ...plan.inserts.flatMap((x, i) =>
      got.has(ids[i] as string)
        ? [
            {
              tenant_id: x.tenantId,
              group_id: gid(x.tenantId, x.packRole),
              user_id: ids[i] as string,
              audit: userAudit(x, ids[i] as string),
            },
          ]
        : [],
    ),
    ...plan.links.map((l) => ({
      tenant_id: l.tenantId,
      group_id: gid(l.tenantId, l.role),
      user_id: l.userId,
    })),
  ];
  if (members.length > 0) await addMembers(w, members);
  return inserted;
}

async function addMembers({ d, tx, ch }: W, members: Member[]) {
  const rows = members.map(({ tenant_id, group_id, user_id }) => ({
    tenant_id,
    group_id,
    user_id,
  }));
  const added = await repo.insertMembers(tx, rows, d.actorId);
  const linkAdds = new Map<string, number>();
  for (const m of members) {
    if (m.audit) {
      ch.changed({ entity: "user", tenantId: m.tenant_id });
      ch.audit(m.audit);
    }
  }
  const newUser = new Set(members.filter((m) => m.audit).map((m) => m.user_id));
  for (const a of added) {
    ch.changed({ entity: "group", tenantId: a.tenant_id });
    if (!newUser.has(a.user_id)) linkAdds.set(a.tenant_id, (linkAdds.get(a.tenant_id) ?? 0) + 1);
  }
  for (const [t, n] of linkAdds)
    ch.audit(
      auditOf("grant", "group", {
        entityId: null,
        entityName: PACK,
        tenantId: t,
        before: null,
        after: null,
        summary: { op: "identity.import.members", source: "mgmt-app", added: n },
      }),
    );
}

type UserBatchArgs = {
  apply: boolean;
  q: UserQuery;
  decide: (ex: ExistingUser[]) => UserBatchResult["plan"];
  groups: GroupIds;
};

async function userBatch(d: StoreDeps, b: UserBatchArgs): Promise<UserBatchResult> {
  const { apply, q, decide, groups } = b;
  const read = async (tx: Tx) => {
    if (q.tenantIds.length === 0) return decide([]);
    return decide(toExistingUsers(await repo.findUsers(tx, q, GROUP_KEYS)));
  };
  if (!apply)
    return withScope(d.db, PLATFORM, async (tx) => {
      const plan = await read(tx);
      return { plan, inserted: plan.inserts };
    });
  return write(d, async (tx, ch) => {
    const plan = await read(tx);
    return { plan, inserted: await writeUsers({ d, tx, ch }, plan, groups) };
  });
}

export function createImportStore(d: StoreDeps): ImportStore {
  return {
    preflight: (actorId) =>
      withScope(d.db, PLATFORM, async (tx) => {
        const r = await repo.preflight(tx, actorId, FEATURES);
        return { actorOk: r.actorOk, packOk: r.features === FEATURES.length };
      }),
    orgBatch: (apply, q, decide) => orgBatch(d, apply, q, decide),
    userBatch: (apply, q, decide, groups) => userBatch(d, { apply, q, decide, groups }),
  };
}
