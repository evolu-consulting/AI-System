// N5-FR-02, N5-FR-03, N5-FR-07 · cài port `ImportStore`: mỗi lô MỘT tx scope platform. Apply ⇒ `withConfigWrite` (bump +
// audit cùng tx khi có đổi, NOTIFY `config_changed` sau commit); dry-run ⇒ `withScope` chỉ câu đọc. Không log gì.
// Chạy lại KHÔNG hoàn tác việc admin thu hồi (review Trung 1 / security L2): gói/Group/grant chỉ dựng cho tenant MỚI tạo;
// user đã có không bao giờ được gắn Group lại.
import { type ConfigSink, type Db, type Tx, withConfigWrite, withScope } from "@ai/db";
import { auditOf } from "../../../lib/audit/audit.write";
import { publishConfigChanged } from "../../../lib/config/config-write";
import {
  packFeatureKeys,
  packGroupKeys,
  roleGrantPairs,
  roleGroupRows,
} from "../../packs/packs.rules";
import { grantAgentsAndNotify } from "../../packs/packs.service";
import type {
  GroupIds,
  ImportStore,
  ManagerSet,
  OrgBatchResult,
  TenantUser,
  UserBatchResult,
  UserQuery,
} from "../application/ports";
import type {
  ExistingTenant,
  ExistingUser,
  OrgCreate,
  OrgPlan,
  PackRole,
  UserInsert,
} from "../domain/import";
import { isPackRole } from "../domain/import.rules";
import * as repo from "./import.repo";

export const PACK = "contracts";
const PLATFORM = { kind: "platform" } as const;
const FEATURES = packFeatureKeys(PACK);
const GROUP_KEYS = packGroupKeys(PACK);
const roleOfKey = (k: string): string => k.slice(PACK.length + 1);

export type StoreDeps = {
  db: Db;
  actorId: string;
  /** Instance mgmt-app nguồn — ghi vào marker tenant (M1). */
  source: string;
  resetHash: string;
  newId: () => string;
};
/** Ngữ cảnh ghi của một lô (tx + sink sự kiện/audit). */
type W = { d: StoreDeps; tx: Tx; ch: ConfigSink };

/** Apply: tx có ghi ⇒ bump + audit; có sự kiện ⇒ NOTIFY một lần sau commit. */
async function write<T>(d: StoreDeps, fn: (tx: Tx, ch: ConfigSink) => Promise<T>): Promise<T> {
  const r = await withConfigWrite(d.db, PLATFORM, fn, { actorId: d.actorId });
  if (r.version !== null) await publishConfigChanged(d.db, r.version, r.events);
  return r.result;
}

/** Bật gói cho tenant MỚI tạo (3 entitlement, 3 Group, 6 grant) + sự kiện + audit `pack.enable`. */
async function packForNew({ d, tx, ch }: W, tids: string[]): Promise<void> {
  if (tids.length === 0) return;
  const ent = await repo.enableEntitlements(tx, tids, FEATURES, d.actorId);
  const grp = await repo.insertRoleGroups(tx, tids, roleGroupRows(PACK), d.actorId);
  const grants = await repo.insertRoleGrants(tx, tids, roleGrantPairs(PACK), d.actorId);
  // UAT B4: trợ lý của gói cho tenant mới, cùng tx (như PUT /packs).
  await grantAgentsAndNotify(tx, { tenantIds: tids, key: PACK, actorId: d.actorId });
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
}

/** Group vai hiện có của các tenant (Group admin đã xoá ⇒ vắng ⇒ user ⇒ GROUP_MISSING). */
async function groupsOf(tx: Tx, tids: string[]): Promise<GroupIds> {
  const out = new Map<string, Record<PackRole, string>>();
  if (tids.length === 0) return out;
  for (const g of await repo.readGroups(tx, tids, GROUP_KEYS)) {
    const role = roleOfKey(g.key);
    if (!isPackRole(role)) continue;
    const m = out.get(g.tenant_id) ?? ({} as Record<PackRole, string>);
    m[role] = g.id;
    out.set(g.tenant_id, m);
  }
  return out;
}

async function createTenants({ d, tx, ch }: W, creates: OrgCreate[]) {
  if (creates.length === 0) return { created: [], lost: [] };
  const rows = creates.map((c) => ({
    id: d.newId(),
    key: c.key,
    name: c.name,
    source: d.source,
    org_id: c.orgId,
  }));
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
        summary: { op: "identity.import", source: "mgmt-app", mgmt_source: d.source },
      }),
    );
  }
  return { created, lost };
}

const toExistingTenants = (rows: repo.TenantRow[]): ExistingTenant[] =>
  rows.map((t) => ({
    id: t.id,
    key: t.key,
    mgmtSource: t.src,
    mgmtOrgId: t.mgmt,
    active: t.active,
    packRevoked: t.pack_revoked,
  }));

async function orgBatch(
  d: StoreDeps,
  apply: boolean,
  q: { orgIds: string[]; keys: string[] },
  decide: (ex: ExistingTenant[]) => OrgPlan,
): Promise<OrgBatchResult> {
  const plan = async (tx: Tx) => decide(toExistingTenants(await repo.findTenants(tx, q, FEATURES)));
  const reused = (p: OrgPlan) => p.reuse.map((r) => r.tenantId);
  if (!apply)
    return withScope(d.db, PLATFORM, async (tx) => {
      const p = await plan(tx);
      return { plan: p, created: [], lost: [], groups: await groupsOf(tx, reused(p)) };
    });
  return write(d, async (tx, ch) => {
    const p = await plan(tx);
    const { created, lost } = await createTenants({ d, tx, ch }, p.creates);
    const fresh = created.map((c) => c.tenantId);
    await packForNew({ d, tx, ch }, fresh);
    return { plan: p, created, lost, groups: await groupsOf(tx, [...reused(p), ...fresh]) };
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

/** Audit mỗi user mới, kèm vai gói được gán (security L3: truy vết user → vai). Không có trường hash. */
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
      pack: PACK,
      pack_role: x.packRole,
      reset_required: x.password === "reset",
      hash_imported: x.password === "import",
    },
  });
}

/** Chèn user (1 câu) rồi thành viên Group vai của CHÍNH user vừa chèn (1 câu); trả hàng thực sự chèn. */
async function writeUsers(w: W, plan: UserBatchResult["plan"], groups: GroupIds) {
  const { d, tx, ch } = w;
  if (plan.inserts.length === 0) return [];
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
  const got = new Set((await repo.insertUsers(tx, rows, d.resetHash, d.actorId)).map((r) => r.id));
  const done = plan.inserts.flatMap((x, i) =>
    got.has(ids[i] as string) ? [{ x, id: ids[i] as string }] : [],
  );
  if (done.length === 0) return [];
  const members = done.map(({ x, id }) => ({
    tenant_id: x.tenantId,
    group_id: groups.get(x.tenantId)?.[x.packRole] as string,
    user_id: id,
  }));
  await repo.insertMembers(tx, members, d.actorId);
  for (const { x, id } of done) {
    ch.changed({ entity: "user", tenantId: x.tenantId });
    ch.changed({ entity: "group", tenantId: x.tenantId });
    ch.audit(userAudit(x, id));
  }
  return done.map(({ x }) => x);
}

/** Dry-run: bỏ hàng sẽ đụng `users_tenant_email_uq` (user tạo tay khác username) ⇒ use case báo USER_CONFLICT như apply. */
async function dryInserted(tx: Tx, q: UserQuery, plan: UserBatchResult["plan"]) {
  if (plan.inserts.length === 0 || q.tenantIds.length === 0) return plan.inserts;
  const taken = new Set(
    (await repo.tenantEmails(tx, q.tenantIds)).map((r) => `${r.tenant_id}\n${r.email}`),
  );
  return plan.inserts.filter((x) => !taken.has(`${x.tenantId}\n${x.email}`));
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
      return { plan, inserted: await dryInserted(tx, q, plan) };
    });
  return write(d, async (tx, ch) => {
    const plan = await read(tx);
    return { plan, inserted: await writeUsers({ d, tx, ch }, plan, groups) };
  });
}

/** M1b · một lô quản lý: đọc (1 câu) → `decide` → chèn (1 câu, apply) + sự kiện/audit mỗi user được đặt (như PUT quản lý). */
async function managerBatch<P extends { sets: ManagerSet[] }>(
  d: StoreDeps,
  apply: boolean,
  tids: string[],
  decide: (users: TenantUser[]) => P,
) {
  const read = async (tx: Tx) => {
    const rows = tids.length === 0 ? [] : await repo.tenantUsers(tx, tids);
    const users: TenantUser[] = rows.map((u) => ({
      tenantId: u.tenant_id,
      id: u.id,
      email: u.email,
      username: u.username,
      managerId: u.manager_id,
    }));
    return { users, plan: decide(users) };
  };
  if (!apply)
    return withScope(d.db, PLATFORM, async (tx) => ({ plan: (await read(tx)).plan, written: 0 }));
  return write(d, async (tx, ch) => {
    const { users, plan } = await read(tx);
    if (plan.sets.length === 0) return { plan, written: 0 };
    const rows = plan.sets.map((s) => ({
      tenant_id: s.tenantId,
      user_id: s.userId,
      manager_id: s.managerId,
    }));
    const got = await repo.insertManagers(tx, rows, d.actorId);
    const nameOf = new Map(users.map((u) => [u.id, u.username]));
    for (const x of got) {
      ch.changed({ entity: "user", tenantId: x.tenant_id });
      ch.audit(
        auditOf("update", "user", {
          entityId: x.user_id,
          entityName: nameOf.get(x.user_id) ?? x.user_id,
          tenantId: x.tenant_id,
          before: null,
          after: null,
          summary: { op: "identity.import", source: "mgmt-app", manager_id: x.manager_id },
        }),
      );
    }
    return { plan, written: got.length };
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
    managerBatch: (apply, tids, decide) => managerBatch(d, apply, tids, decide),
  };
}
