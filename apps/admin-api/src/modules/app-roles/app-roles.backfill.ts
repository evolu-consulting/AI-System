// CR-112 S6 · ADM-FR-83 · ADM-BR-17: chuẩn hoá vai cho dữ liệu khách có sẵn. Mỗi tenant MỘT tx, số câu cố định (Luật 4c):
// (1) `admin.app_roles_backfill(tenant)` tạo hàng vai mặc định từ Group `<k'>-viewer|editor|owner` · (2) `compileRoles` (S1) thêm mã
// gói thiếu + gỡ mã gói thừa CHỈ trên Group của vai · (3) Group vai tuỳ biến nhận agent trợ lý như Group mặc định cùng mức ·
// (4) đọc báo cáo (vai, thành viên, trần, Group ngoài vai có mã gói — chỉ báo, KHÔNG đụng). Dry-run = cùng đường rồi ROLLBACK
// (không ghi, không audit, không NOTIFY); apply = `withConfigWrite` (audit mỗi thay đổi, bump + NOTIFY sau commit). Idempotent.
// Cần quyền chủ migration (DATABASE_URL owner — hàm backfill chỉ owner gọi được).
import { type ConfigSink, type Db, type Tx, withConfigWrite, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { auditOf } from "../../lib/audit/audit.write";
import { publishConfigChanged } from "../../lib/config/config-write";
import { grantRoleAgents, recordAgentGrants } from "./app-roles.agents";
import { type CompileResult, compileRoles, recordCompile } from "./app-roles.compile";
import * as repo from "./app-roles.repo";
import { ceilingOf, isEffective, roleGroupKey } from "./app-roles.rules";

const PLATFORM = { kind: "platform" } as const;

export type RoleLine = {
  role_id: string;
  key: string;
  group_key: string;
  level: string;
  is_default: boolean;
  members: number;
  effective: boolean;
  created: boolean;
  add: string[];
  remove: string[];
  agents_added: number;
};
export type PackReport = { pack: string; ceiling: string | null; roles: RoleLine[] };
export type TenantReport = {
  tenant_id: string;
  tenant_key: string;
  roles_created: number;
  grants_added: number;
  grants_removed: number;
  agent_grants_added: number;
  packs: PackReport[];
  /** Group không phải vai có mã gói (vd `pb-ke-toan`) — "quyền ngoài vai", chỉ báo, không thu hồi. */
  outside_roles: { group_key: string; features: string[] }[];
  above_ceiling: { pack: string; key: string; level: string; ceiling: string | null }[];
};
export type BackfillReport = {
  mode: "dry-run" | "apply";
  tenants: TenantReport[];
  totals: {
    roles_created: number;
    grants_added: number;
    grants_removed: number;
    agent_grants_added: number;
  };
};
export type BackfillOpts = { apply: boolean; tenantKey?: string; actorId?: string | null };

class DryRun extends Error {
  constructor(readonly report: TenantReport) {
    super("dry-run rollback");
  }
}

const run = async <T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T[]> =>
  (await tx.execute(q)) as unknown as T[];

/** Group ngoài vai (không có hàng `app_roles`) đang có mã gói `<k'>-read|write|admin` của gói có vai trong tenant. */
function outsideRoles(tx: Tx, tenantId: string) {
  return run<{ group_key: string; features: string[] }>(
    tx,
    sql`select g.key as group_key, array_agg(f.key order by f.key) as features
      from admin.feature_grants fg
      join admin.groups g on g.id = fg.group_id
      join admin.features f on f.id = fg.feature_id
      where fg.tenant_id = ${tenantId}::uuid
        and not exists (select 1 from admin.app_roles r where r.group_id = g.id)
        and exists (select 1 from admin.app_roles p where p.tenant_id = ${tenantId}::uuid
          and f.key in (replace(p.pack, '_', '-') || '-read', replace(p.pack, '_', '-') || '-write',
            replace(p.pack, '_', '-') || '-admin'))
      group by g.key order by g.key`,
  );
}

type Changes = {
  created: Set<string>;
  compiled: CompileResult;
  agents: { g: string; a: string }[];
};

/** Ghi (trong tx) + trả các thay đổi; audit/sự kiện ghi sau ở `auditChanges` (dry-run: sink bỏ đi cùng ROLLBACK). */
async function applyTenant(tx: Tx, tenantId: string, actorId: string | null): Promise<Changes> {
  const created = await run<{ id: string }>(
    tx,
    sql`select id from admin.app_roles_backfill(${tenantId}::uuid) as id`,
  );
  const compiled = await compileRoles(tx, { tenantId, roleIds: null, actorId });
  const agents = await grantRoleAgents(tx, { tenantId, roleIds: null, actorId });
  return { created: new Set(created.map((r) => r.id)), compiled, agents };
}

function auditChanges(
  ch: ConfigSink,
  tenantId: string,
  ch0: Changes,
  roles: repo.RoleListRow[],
): void {
  const byGroup = new Map(roles.map((r) => [r.group_id, roleGroupKey(r.pack, r.key)]));
  for (const r of roles.filter((x) => ch0.created.has(x.id)))
    ch.audit(
      auditOf("create", "group", {
        entityId: r.group_id,
        entityName: roleGroupKey(r.pack, r.key),
        tenantId,
        before: null,
        after: null,
        summary: { op: "role.backfill", role_id: r.id, pack: r.pack, key: r.key, level: r.level },
      }),
    );
  if (ch0.created.size > 0) ch.changed({ entity: "group", tenantId });
  recordCompile(ch, tenantId, ch0.compiled);
  recordAgentGrants(ch, tenantId, ch0.agents, (g) => byGroup.get(g) ?? g);
}

function roleLine(r: repo.RoleListRow, c: Changes): RoleLine {
  const of = (xs: CompileResult["added"]) =>
    xs
      .filter((x) => x.group_id === r.group_id)
      .map((x) => x.feature_key)
      .sort();
  return {
    role_id: r.id,
    key: r.key,
    group_key: roleGroupKey(r.pack, r.key),
    level: r.level,
    is_default: r.is_default,
    members: r.member_count,
    effective: isEffective(r.level, ceilingOf(r.pack, r.entitled ?? [])),
    created: c.created.has(r.id),
    add: of(c.compiled.added),
    remove: of(c.compiled.removed),
    agents_added: c.agents.filter((a) => a.g === r.group_id).length,
  };
}

function buildReport(
  t: { id: string; key: string },
  roles: repo.RoleListRow[],
  c: Changes,
  outside: TenantReport["outside_roles"],
): TenantReport {
  const packs = new Map<string, PackReport>();
  const above: TenantReport["above_ceiling"] = [];
  for (const r of roles) {
    const ceiling = ceilingOf(r.pack, r.entitled ?? []);
    const p = packs.get(r.pack) ?? { pack: r.pack, ceiling, roles: [] };
    const line = roleLine(r, c);
    p.roles.push(line);
    packs.set(r.pack, p);
    if (!line.effective) above.push({ pack: r.pack, key: r.key, level: r.level, ceiling });
  }
  return {
    tenant_id: t.id,
    tenant_key: t.key,
    roles_created: c.created.size,
    grants_added: c.compiled.added.length,
    grants_removed: c.compiled.removed.length,
    agent_grants_added: c.agents.length,
    packs: [...packs.values()],
    outside_roles: outside,
    above_ceiling: above,
  };
}

async function tenantStep(
  tx: Tx,
  ch: ConfigSink,
  t: { id: string; key: string },
  actorId: string | null,
) {
  const changes = await applyTenant(tx, t.id, actorId);
  const roles = await repo.listRoles(tx, { tenantId: t.id, pack: null });
  auditChanges(ch, t.id, changes, roles);
  return buildReport(t, roles, changes, await outsideRoles(tx, t.id));
}

/** Một tenant: dry-run ⇒ ROLLBACK (ném `DryRun` mang báo cáo); apply ⇒ commit + NOTIFY `config_changed`. */
export async function backfillTenant(
  db: Db,
  t: { id: string; key: string },
  o: { apply: boolean; actorId: string | null },
): Promise<TenantReport> {
  if (!o.apply) {
    const sink: ConfigSink = { changed: () => {}, audit: () => {} };
    try {
      await withScope(db, PLATFORM, async (tx) => {
        throw new DryRun(await tenantStep(tx, sink, t, o.actorId));
      });
    } catch (e) {
      if (e instanceof DryRun) return e.report;
      throw e;
    }
    throw new Error("unreachable");
  }
  const r = await withConfigWrite(db, PLATFORM, (tx, ch) => tenantStep(tx, ch, t, o.actorId), {
    actorId: o.actorId,
  });
  if (r.version !== null) await publishConfigChanged(db, r.version, r.events);
  return r.result;
}

/** Mọi tenant (hoặc `tenantKey`), lần lượt, mỗi tenant một tx. Tenant lạ ⇒ ném `TENANT_NOT_FOUND`. */
export async function runRolesBackfill(db: Db, o: BackfillOpts): Promise<BackfillReport> {
  const key = o.tenantKey ?? null;
  const tenants = await withScope(db, PLATFORM, (tx) =>
    run<{ id: string; key: string }>(
      tx,
      sql`select id, key from admin.tenants where (${key}::text is null or key = ${key}::text) order by key`,
    ),
  );
  if (key !== null && tenants.length === 0) throw new Error("TENANT_NOT_FOUND");
  const out: TenantReport[] = [];
  for (const t of tenants)
    out.push(await backfillTenant(db, t, { apply: o.apply, actorId: o.actorId ?? null }));
  const sum = (f: (t: TenantReport) => number) => out.reduce((n, t) => n + f(t), 0);
  return {
    mode: o.apply ? "apply" : "dry-run",
    tenants: out,
    totals: {
      roles_created: sum((t) => t.roles_created),
      grants_added: sum((t) => t.grants_added),
      grants_removed: sum((t) => t.grants_removed),
      agent_grants_added: sum((t) => t.agent_grants_added),
    },
  };
}
