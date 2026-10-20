// I1 · use case importer mgmt-app: đọc nguồn ⇒ N5 (org/user) ⇒ tra tenant/user ⇒ dựng kế hoạch ⇒ file ⇒ ghi theo lô (dry-run:
// chỉ đếm "đã có") ⇒ đối soát. Chạy lại an toàn (id tất định + ON CONFLICT DO NOTHING); `Checkpoint` bỏ qua lô đã xong.
import { buildPlan } from "../domain/build.rules";
import type { Ctx } from "../domain/context";
import { targetId } from "../domain/ids.rules";
import { memberships, usersExport } from "../domain/map-identity.rules";
import {
  bump,
  G1_TABLES,
  type Plan,
  push,
  type Row,
  TABLE_ORDER,
  type TableName,
} from "../domain/plan";
import { str } from "../domain/values.rules";
import { loadSnapshot } from "./load";
import type {
  Checkpoint,
  FileSink,
  FileSource,
  IdentityPort,
  SourceReader,
  TargetStore,
  VisibilityProbe,
} from "./ports";
import { type ReconcileReport, reconcile } from "./reconcile";

export type ImportOpts = {
  source: string;
  apply: boolean;
  batch: number;
  /** Org nhận tài liệu tri thức chung (domain=general); null ⇒ không chuyển (đếm ở no_tenant). */
  knowledgeOrg: string | null;
  /** Actor (platform admin) — dự phòng `created_by` khi org không có chủ. */
  actorId: string;
  withGraph: boolean;
  diffSample: number;
};
export type ImportDeps = {
  reader: SourceReader;
  identity: IdentityPort;
  target: TargetStore;
  files: { source: FileSource | null; sink: FileSink | null };
  checkpoint: Checkpoint;
  visible: VisibilityProbe;
  now: () => number;
};
export type TableCount = { planned: number; inserted: number; existing: number };
export type ImportReport = {
  dry_run: boolean;
  source: string;
  ms: number;
  identity: unknown;
  /** Quản lý trực tiếp đặt lần này (từ báo cáo N5). */
  managers: number;
  read: Record<string, number>;
  no_tenant: Record<string, number>;
  tables: Partial<Record<TableName, TableCount>>;
  skipped_tables: string[];
  /** Tenant có marker nhưng N5 bỏ qua (đã tắt / đã thu hồi gói) — importer không ghi gì vào đó (review A-4). */
  skipped_tenants: SkippedTenant[];
  issues_by_code: Record<string, number>;
  issues_sample: Plan["issues"];
  reconcile: ReconcileReport | null;
};

export type SkippedTenant = {
  orgId: string;
  tenantId: string;
  reason: "TENANT_INACTIVE" | "PACK_REVOKED";
};

type Resolved = {
  skipped: SkippedTenant[];
  tenantOf: Map<string, string>;
  userOf: Map<string, string>;
  owners: Map<string, string>;
};

async function resolve(
  d: ImportDeps,
  o: ImportOpts,
  members: ReturnType<typeof memberships>,
  orgs: string[],
): Promise<Resolved> {
  const all = await d.identity.tenants(o.source);
  // review A-4: chỉ tenant N5 tạo/dùng lại được (đang hoạt động, gói chưa thu hồi); tenant khác ⇒ bỏ + báo, không ghi gì.
  const skipped = all
    .filter((t) => !t.active || t.packRevoked)
    .map(
      (t): SkippedTenant => ({
        orgId: t.orgId,
        tenantId: t.id,
        reason: t.active ? "PACK_REVOKED" : "TENANT_INACTIVE",
      }),
    );
  const tenantOf = new Map(
    all.filter((t) => t.active && !t.packRevoked).map((t) => [t.orgId, t.id]),
  );
  const known = new Set(all.map((t) => t.orgId));
  if (!o.apply)
    for (const org of orgs)
      if (!known.has(org)) tenantOf.set(org, targetId(o.source, "tenant", org));
  const users = await d.identity.users([...tenantOf.values()]);
  const userOf = new Map(users.map((u) => [`${u.tenantId}|${u.email}`, u.id]));
  const owners = new Map<string, string>();
  for (const m of members.values()) {
    const tid = tenantOf.get(m.orgId);
    const uid = tid ? userOf.get(`${tid}|${m.email}`) : undefined;
    if (tid && uid && m.role === "owner" && !owners.has(tid)) owners.set(tid, uid);
  }
  return { skipped, tenantOf, userOf, owners };
}

function context(o: ImportOpts, r: Resolved): Ctx {
  const issues: Plan["issues"] = [];
  const actorUsed = new Set<string>();
  // review A-15: org không có chủ ⇒ cột NOT NULL `created_by`/`started_by` nhận id actor (platform admin, tenant khác) — báo một
  // lần mỗi tenant (ACTOR_AS_CREATOR) để vận hành gán lại; cột cho phép null thì mapper đã để null.
  const fallback = (tid: string): string => {
    const owner = r.owners.get(tid);
    if (owner) return owner;
    if (!actorUsed.has(tid)) {
      actorUsed.add(tid);
      issues.push({ entity: "tenant", ref: tid, code: "ACTOR_AS_CREATOR" });
    }
    return o.actorId;
  };
  return {
    source: o.source,
    tenantOf: (org) => (org ? (r.tenantOf.get(org) ?? null) : null),
    userOf: (tid, email) => (email ? (r.userOf.get(`${tid}|${email}`) ?? null) : null),
    fallbackUser: fallback,
    knowledgeOrg: o.knowledgeOrg,
    issues,
  };
}

/** File HĐ: đọc nguồn, đưa vào kho đích, thêm hàng `contracts.files` + gắn `file_id` (apply); dry-run chỉ kiểm có/không. */
async function moveFiles(
  d: ImportDeps,
  o: ImportOpts,
  plan: Plan,
  jobs: ReturnType<typeof buildPlan>["files"],
  out: Map<string, string>,
): Promise<void> {
  for (const j of jobs) {
    const f = d.files.source ? await d.files.source.readDir(j.dir) : null;
    if (!f) {
      plan.issues.push({ entity: "file", ref: j.dir, code: "FILE_MISSING" });
      continue;
    }
    const sha = new Bun.CryptoHasher("sha256").update(f.bytes).digest("hex");
    out.set(j.fileRowId, sha);
    const t = plan.tenants.get(j.tenantId);
    if (!o.apply || !d.files.sink || !t) continue;
    const c = (t.rows["contracts.contracts"] ?? []).find((x) => x.id === j.contractId);
    if (c) c.file_id = j.fileRowId;
    // chạy lại: hàng file đã có ⇒ không đưa bytes lên FileBox lần nữa (không tạo file mồ côi)
    if ((await d.target.existing(j.tenantId, "contracts.files", [{ id: j.fileRowId }])) > 0)
      continue;
    const up = await d.files.sink.put(`t_${j.tenantId}`, j.name, f.bytes);
    push(t, "contracts.files", {
      id: j.fileRowId,
      org: `t_${j.tenantId}`,
      file_id: up.fileId,
      version_id: up.versionId,
      name: j.name,
      mime: j.mime,
      size_bytes: f.bytes.byteLength,
      created_by: j.createdBy,
    });
  }
}

/** Một bảng của một tenant, theo lô: dry-run đếm "đã có"; apply ghi lô chưa đánh dấu xong rồi đánh dấu (chạy tiếp được). */
async function writeTable(
  d: ImportDeps,
  o: ImportOpts,
  tid: string,
  table: TableName,
  rows: Row[],
  c: TableCount,
): Promise<void> {
  c.planned += rows.length;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += o.batch) {
    const part = rows.slice(i, i + o.batch);
    const key = `${tid}|${table}|${i / o.batch}`;
    if (!o.apply) c.existing += Math.max(0, await d.target.existing(tid, table, part));
    else if (!d.checkpoint.done(key)) {
      inserted += await d.target.write(tid, table, part);
      await d.checkpoint.mark(key);
    }
  }
  c.inserted += inserted;
  if (o.apply) c.existing += rows.length - inserted;
}

async function writeAll(
  d: ImportDeps,
  o: ImportOpts,
  plan: Plan,
  skipped: Set<TableName>,
): Promise<ImportReport["tables"]> {
  const tables: ImportReport["tables"] = {};
  for (const t of plan.tenants.values())
    for (const table of TABLE_ORDER) {
      const rows = t.rows[table] ?? [];
      if (rows.length === 0 || skipped.has(table)) continue;
      const c = tables[table] ?? { planned: 0, inserted: 0, existing: 0 };
      tables[table] = c;
      await writeTable(d, o, t.tenantId, table, rows, c);
    }
  return tables;
}

export async function runImport(o: ImportOpts, d: ImportDeps): Promise<ImportReport> {
  const t0 = d.now();
  const snap = await loadSnapshot(d.reader, o.batch, o.withGraph);
  const members = memberships(snap.docs.memberships ?? []);
  const orgs = (snap.docs.orgs ?? []).map((x) => str(x.src.id, 128) ?? x.id);
  const identity = await d.identity.run(
    usersExport(o.source, snap.docs.orgs ?? [], snap.docs.users ?? [], members),
    o.apply,
  );
  const r = await resolve(d, o, members, orgs);
  // M1b: N5 nhập `manager_email` (khoá cặp quản lý trong tx của nó; MANAGER_CYCLE/MANAGER_UNKNOWN ở báo cáo identity)
  const managers = (identity as { managers?: { set?: number } }).managers?.set ?? 0;
  const ctx = context(o, r);
  const { plan, files } = buildPlan(snap, ctx, members, orgs);
  const shas = new Map<string, string>();
  await moveFiles(d, o, plan, files, shas);
  const skipped = new Set<TableName>();
  for (const g of G1_TABLES) if (!(await d.target.hasTable(g))) skipped.add(g);
  const tables = await writeAll(d, o, plan, skipped);
  const byCode: Record<string, number> = {};
  for (const i of plan.issues) bump(byCode, i.code);
  for (const s of r.skipped) bump(byCode, `tenant.${s.reason}`);
  for (const i of (identity as { issues?: { code: string }[] }).issues ?? [])
    bump(byCode, `identity.${i.code}`);
  const rec = o.apply ? await reconcile(d, o, snap, plan, members, r.userOf, shas) : null;
  return {
    dry_run: !o.apply,
    source: o.source,
    ms: Math.round(d.now() - t0),
    identity,
    managers,
    read: plan.read,
    no_tenant: plan.noTenant,
    tables,
    skipped_tables: [...skipped],
    skipped_tenants: r.skipped,
    issues_by_code: byCode,
    issues_sample: plan.issues.slice(0, 50),
    reconcile: rec,
  };
}
