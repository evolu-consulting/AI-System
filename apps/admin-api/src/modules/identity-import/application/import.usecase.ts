// N5-FR-02…07 · N5-NFR-01 · use case chuyển user mgmt-app: kiểm actor/gói → lô org → lô user → báo cáo (spec §2, §7 R1–R9).
// Dry-run (apply=false) đi cùng câu đọc, không ghi. Không biết SQL/HTTP — chỉ port + luật domain.
import { ImportAbort } from "../domain/errors";
import type {
  ImportReport,
  Issue,
  OrgIn,
  OrgSeen,
  PackRole,
  UserIn,
  UserInsert,
} from "../domain/import";
import {
  chunk,
  normEmail,
  planOrgs,
  planUsers,
  tenantKeyFor,
  usernameBase,
  usernameFallback,
  validEmail,
} from "../domain/import.rules";
import type { Clock, ErrorClass, ImportStore, OrgBatchResult, UserQuery } from "./ports";

export type ImportInput = {
  /** Instance mgmt-app nguồn (marker tenant, M1). */
  source: string;
  orgs: OrgIn[];
  users: UserIn[];
  /** Lỗi hàng từ mapper (BAD_ROW). */
  issues: Issue[];
  orgRows: number;
  userRows: number;
};
export type ImportOpts = { actorId: string; apply: boolean; batch: number };
export type BatchKind = "check" | "org" | "user";
export type ImportDeps = {
  store: ImportStore;
  clock: Clock;
  /** Lỗi dữ liệu/ràng buộc (SQLSTATE lớp 22/23) ⇒ hỏng MỘT lô (R1, M2); null ⇒ ném tiếp. */
  constraintError: ErrorClass;
  onBatch?: (kind: BatchKind, i: number) => void;
};

type Run = {
  report: ImportReport;
  tenantOf: Map<string, string | null>;
  keyOf: Map<string, string>;
  groups: Map<string, Readonly<Record<PackRole, string>>>;
};

function emptyReport(dry: boolean, input: ImportInput): ImportReport {
  return {
    dry_run: dry,
    orgs: { read: input.orgRows, created: 0, existing: 0, errors: 0 },
    users: {
      read: input.userRows,
      created: 0,
      existing: 0,
      errors: 0,
      hash_imported: 0,
      reset_required: 0,
    },
    issues: [...input.issues],
    accounts: [],
    batches: 0,
    ms: 0,
  };
}

function absorbOrgs(r: Run, res: OrgBatchResult, apply: boolean): void {
  r.report.issues.push(...res.plan.issues);
  for (const id of res.plan.failed) r.tenantOf.set(id, null);
  for (const x of res.plan.reuse) {
    r.tenantOf.set(x.orgId, x.tenantId);
    r.keyOf.set(x.tenantId, x.key);
  }
  const made = apply
    ? res.created
    : res.plan.creates.map((c) => ({ ...c, tenantId: `new:${c.orgId}` }));
  for (const x of made) {
    r.tenantOf.set(x.orgId, x.tenantId);
    r.keyOf.set(x.tenantId, x.key);
  }
  for (const x of res.lost) {
    r.tenantOf.set(x.orgId, null);
    r.report.issues.push({ kind: "org", ref: x.orgId, code: "ORG_KEY_TAKEN" });
  }
  for (const [tid, g] of res.groups) r.groups.set(tid, g);
  r.report.orgs.created += made.length;
  r.report.orgs.existing += res.plan.reuse.length;
}

const cloneSeen = (s: OrgSeen): OrgSeen => ({ ids: new Set(s.ids), keys: new Set(s.keys) });

async function orgPhase(r: Run, input: ImportInput, o: ImportOpts, d: ImportDeps): Promise<void> {
  let seen: OrgSeen = { ids: new Set(), keys: new Set() };
  for (const part of chunk(input.orgs, o.batch)) {
    const q = { orgIds: part.map((x) => x.id), keys: part.map(tenantKeyFor) };
    let next = seen;
    // Bản sao mỗi lần thử tx (withScope thử lại 40P01) ⇒ không đánh dấu id/key hai lần.
    const decide = (ex: Parameters<typeof planOrgs>[1]) => {
      next = cloneSeen(seen);
      return planOrgs(part, ex, input.source, next);
    };
    try {
      absorbOrgs(r, await d.store.orgBatch(o.apply, q, decide), o.apply);
      seen = next;
    } catch (err) {
      if (d.constraintError(err) === null) throw err;
      for (const x of part) {
        r.tenantOf.set(x.id, null);
        r.report.issues.push({ kind: "org", ref: x.id, code: "BATCH_FAILED" });
      }
    }
    r.report.batches++;
    d.onBatch?.("org", r.report.batches);
  }
}

function userQuery(r: Run, part: UserIn[]): UserQuery {
  const tids = new Set<string>();
  const names: string[] = [];
  for (const u of part) {
    const tid = u.orgId === null ? null : r.tenantOf.get(u.orgId);
    const email = normEmail(u.email);
    if (!tid || tid.startsWith("new:") || !validEmail(email)) continue;
    tids.add(tid);
    names.push(usernameBase(email), usernameFallback(email));
  }
  return { tenantIds: [...tids], usernames: names };
}

function tally(r: Run, plan: { inserts: UserInsert[] }, inserted: UserInsert[]): void {
  const done = new Set(inserted.map((x) => `${x.tenantId}\n${x.email}`));
  for (const x of plan.inserts)
    if (!done.has(`${x.tenantId}\n${x.email}`))
      r.report.issues.push({ kind: "user", ref: x.email, code: "USER_CONFLICT" });
  const u = r.report.users;
  for (const x of inserted) {
    u.created++;
    if (x.password === "import") u.hash_imported++;
    else u.reset_required++;
    const tenant_key = r.keyOf.get(x.tenantId) ?? "";
    r.report.accounts.push({
      tenant_key,
      email: x.email,
      username: x.username,
      reset_required: x.password === "reset",
    });
  }
}

async function userPhase(r: Run, users: UserIn[], o: ImportOpts, d: ImportDeps): Promise<void> {
  let seen = new Set<string>();
  // Tenant mới (dry-run) chưa có Group nhưng sẽ được tạo; tenant thật phải có đủ Group vai (không tạo lại — L2).
  const hasGroup = (tid: string, role: PackRole) =>
    tid.startsWith("new:") || r.groups.get(tid)?.[role] !== undefined;
  for (const part of chunk(users, o.batch)) {
    let next = seen;
    // Bản sao mỗi lần `decide` chạy: withScope có thể thử lại tx (40P01) ⇒ không được đánh dấu email hai lần.
    const decide = (ex: Parameters<typeof planUsers>[2]) => {
      next = new Set(seen);
      return planUsers(part, r.tenantOf, ex, next, hasGroup);
    };
    try {
      const res = await d.store.userBatch(o.apply, userQuery(r, part), decide, r.groups);
      seen = next;
      r.report.issues.push(...res.plan.issues);
      r.report.users.existing += res.plan.existing;
      tally(r, res.plan, res.inserted);
    } catch (err) {
      if (d.constraintError(err) === null) throw err;
      for (const u of part)
        r.report.issues.push({ kind: "user", ref: normEmail(u.email), code: "BATCH_FAILED" });
    }
    r.report.batches++;
    d.onBatch?.("user", r.report.batches);
  }
}

export async function runImport(
  input: ImportInput,
  o: ImportOpts,
  d: ImportDeps,
): Promise<ImportReport> {
  const t0 = d.clock.now();
  const pre = await d.store.preflight(o.actorId);
  d.onBatch?.("check", 0);
  if (!pre.actorOk) throw new ImportAbort("ACTOR_INVALID");
  if (!pre.packOk) throw new ImportAbort("PACK_NOT_INSTALLED");
  const r: Run = {
    report: emptyReport(!o.apply, input),
    tenantOf: new Map(),
    keyOf: new Map(),
    groups: new Map(),
  };
  await orgPhase(r, input, o, d);
  await userPhase(r, input.users, o, d);
  r.report.orgs.errors = r.report.issues.filter((i) => i.kind === "org").length;
  r.report.users.errors = r.report.issues.filter((i) => i.kind === "user").length;
  r.report.ms = Math.round(d.clock.now() - t0);
  return r.report;
}
