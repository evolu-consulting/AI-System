// niti-import · nhập dữ liệu của MỘT tài khoản mgmt-app (chủ HĐ theo email) vào MỘT tenant, mọi HĐ thuộc user đích (tra theo
// username — vắng ⇒ lỗi). Dry-run (mặc định): kế hoạch + đối soát nguồn ↔ đích hiện tại, không ghi, không tải file. Apply: file gốc
// vào kho đích (sha256 nguồn), rồi MỘT tx mỗi HĐ (id tất định + ON CONFLICT ⇒ chạy lại không nhân đôi; lượt sau gắn file cho HĐ đã
// nhập), rồi đối soát lại từ DB đích (số hàng, tổng tiền, danh sách HĐ, sha256 đọc lại từ kho). Không ghi danh tính, không gửi gì.
import { companyIndex } from "../domain/companies.rules";
import { targetId } from "../domain/ids.rules";
import {
  buildOwnerPlan,
  type ContractLine,
  ownerCtx,
  partnerName,
  sourceContracts,
  unitsOf,
  unmappedFields,
} from "../domain/owner-plan.rules";
import { type OwnerScope, scopeToOwner } from "../domain/owner-scope.rules";
import { bump, type Plan, type Row, type TableName } from "../domain/plan";
import { sourceMoney } from "../domain/reconcile.rules";
import { type FileStats, moveFiles } from "./files";
import { loadIndices } from "./owner-export";
import type { BatchState, OwnerDeps, OwnerOpts } from "./owner-ports";

type Line = { source: number; planned: number; target: number };
type Money = { source: string; planned: string; target: string; ok: boolean };
export type OwnerReport = {
  mode: "dry-run" | "apply";
  source: string;
  tenant: { key: string; id: string };
  owner: { email: string; username: string; user_id: string };
  ms: number;
  source_orgs: string[];
  counts: Record<string, Line>;
  /** dry-run: ok = nguồn khớp kế hoạch; apply: nguồn = kế hoạch = đích (tuyệt đối). */
  money: Record<string, Money>;
  money_ok: boolean;
  contracts: (ContractLine & { file_found: boolean; target: Row | null })[];
  partners: { name: string | null; tax: string | null }[];
  files: FileStats & { checksum_ok: number; checksum_bad: number };
  tables: Partial<Record<TableName, { planned: number; inserted: number }>>;
  unmapped_fields: Record<string, number>;
  issues_by_code: Record<string, number>;
  issues_sample: Plan["issues"];
  excluded: Record<string, number>;
  not_imported: Record<string, number>;
};

async function resolveTarget(d: OwnerDeps, o: OwnerOpts) {
  const t = await d.identity.tenantByKey(o.tenantKey);
  if (!t) throw new Error("TENANT_NOT_FOUND");
  if (!t.active) throw new Error("TENANT_INACTIVE");
  const u = await d.identity.userByUsername(t.id, o.ownerUsername);
  if (!u || !u.active) throw new Error("OWNER_USER_NOT_FOUND");
  return { tid: t.id, userId: u.id };
}

const line = (source: number, planned: number, target: number): Line => ({
  source,
  planned,
  target,
});

function counts(scope: OwnerScope, p: Plan, tid: string, st: BatchState): Record<string, Line> {
  const s = scope.snap.docs;
  const cs = s.contracts ?? [];
  const ev = s.partner_events ?? [];
  const rows = (t: TableName) => p.tenants.get(tid)?.rows[t] ?? [];
  const kinds = (xs: Row[], k: string) => xs.filter((r) => r.kind === k).length;
  const items = cs.reduce(
    (a, d) =>
      a + (Array.isArray(d.src.items) ? d.src.items.filter((x) => (x as Row)?.name).length : 0),
    0,
  );
  const pc = rows("contracts.contracts");
  return {
    contracts: line(
      cs.filter((d) => d.src.kind !== "addendum").length,
      kinds(pc, "contract"),
      kinds(st.contracts, "contract"),
    ),
    appendices: line(
      cs.filter((d) => d.src.kind === "addendum").length,
      kinds(pc, "appendix"),
      kinds(st.contracts, "appendix"),
    ),
    items: line(items, rows("contracts.contract_items").length, st.items),
    obligations: line(
      (s.obligations ?? []).length,
      rows("contracts.obligations").length,
      st.obligations,
    ),
    partner_events: line(ev.length, rows("contracts.partner_events").length, st.partner_events),
    ratings: line(
      ev.filter((e) => e.src.type === "rating").length,
      rows("contracts.partner_events").filter((r) => r.type === "rating").length,
      st.ratings,
    ),
    partner_events_voided: line(
      ev.filter((e) => e.src.voided === true).length,
      rows("contracts.partner_event_voids").length,
      st.partner_events_voided,
    ),
    files: line(cs.filter((d) => d.src.file).length, rows("contracts.files").length, st.files),
  };
}

function money(scope: OwnerScope, p: Plan, x: { tid: string; st: BatchState; apply: boolean }) {
  const src: Record<string, bigint> = {};
  for (const m of sourceMoney(scope.snap, scope.orgs).values())
    for (const [k, v] of Object.entries(m)) src[k] = (src[k] ?? 0n) + (v ?? 0n);
  const plan: Record<string, bigint | undefined> = p.tenants.get(x.tid)?.money ?? {};
  const target: Record<string, bigint> = {
    "contracts.total_value": x.st.contracts.reduce((a, r) => a + BigInt(String(r.value ?? 0)), 0n),
    "obligations.amount": x.st.obligations_amount,
    "partner_events.amount": x.st.partner_events_amount,
  };
  const out: Record<string, Money> = {};
  for (const [k, c] of Object.entries(target)) {
    const [a, b] = [src[k] ?? 0n, plan[k] ?? 0n];
    out[k] = {
      source: `${a}`,
      planned: `${b}`,
      target: `${c}`,
      ok: a === b && (!x.apply || b === c),
    };
  }
  return out;
}

/** sha256 đọc lại từ kho đích ↔ sha256 bytes nguồn (theo id hàng file). */
async function checksums(d: OwnerDeps, tid: string, st: BatchState, shas: Map<string, string>) {
  const ids = st.contracts.map((r) => r.file_id).filter(Boolean) as string[];
  const out = { ok: 0, bad: 0 };
  if (!d.files.sink) return out;
  for (const r of await d.target.readBack(tid, "contracts.files", ids)) {
    const bytes = await d.files.sink.readBack(String(r.file_id), String(r.org ?? ""));
    const sha = bytes ? new Bun.CryptoHasher("sha256").update(bytes).digest("hex") : null;
    if (sha && sha === shas.get(String(r.id))) out.ok++;
    else out.bad++;
  }
  return out;
}

function contractLines(
  scope: OwnerScope,
  st: BatchState,
  source: string,
  shas: Map<string, string>,
) {
  const back = new Map(st.contracts.map((r) => [String(r.id), r]));
  return sourceContracts(scope.snap.docs.contracts ?? []).map((l) => {
    const t = back.get(targetId(source, "contract", l.mgmt_id));
    return {
      ...l,
      file_found: shas.has(targetId(source, "file", l.mgmt_id)),
      target: t
        ? {
            number: t.number,
            partner: partnerName(t.direction, t.seller, t.buyer),
            value: t.value,
            signed_date: t.signed_date,
            start_date: t.start_date,
            end_date: t.end_date,
            has_file: t.file_id != null,
            status: t.status,
          }
        : null,
    };
  });
}

async function writeUnits(d: OwnerDeps, o: OwnerOpts, p: Plan, tid: string) {
  const tables: OwnerReport["tables"] = {};
  const add = (table: TableName, planned: number, inserted: number) => {
    const c = tables[table] ?? { planned: 0, inserted: 0 };
    c.planned += planned;
    c.inserted += inserted;
    tables[table] = c;
  };
  const t = p.tenants.get(tid);
  for (const u of t ? unitsOf(t) : []) {
    const done = o.apply ? await d.owner.writeUnit(tid, u.tables, o.today) : {};
    for (const [table, rows] of u.tables) add(table, rows.length, done[table] ?? 0);
    // mốc nhắc đã qua đánh dấu trong cùng tx (không có trong kế hoạch)
    if (!u.tables.some(([x]) => x === "contracts.contract_reminders"))
      add("contracts.contract_reminders", 0, done["contracts.contract_reminders"] ?? 0);
  }
  return tables;
}

function issues(p: Plan, bad: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of p.issues) bump(out, i.code);
  if (bad > 0) bump(out, "FILE_CHECKSUM_MISMATCH", bad);
  return out;
}

export async function runOwnerImport(o: OwnerOpts, d: OwnerDeps): Promise<OwnerReport> {
  const t0 = d.now();
  const email = o.ownerEmail.trim().toLowerCase();
  const { tid, userId } = await resolveTarget(d, o);
  if (o.meta && o.meta.owner_email !== email) throw new Error("EXPORT_OWNER_MISMATCH");
  const scope = scopeToOwner(await loadIndices(d.reader, o.batch), email);
  const ctx = ownerCtx({ source: o.source, tenantId: tid, ownerEmail: email, ownerId: userId }, []);
  if (scope.orgs.length > 1) {
    if (o.apply) throw new Error("OWNER_SPANS_ORGS"); // thư mục file theo org — chưa hỗ trợ nhiều org
    ctx.issues.push({ entity: "owner", ref: scope.orgs.join(","), code: "OWNER_SPANS_ORGS" });
  }
  const { plan, files } = buildOwnerPlan(scope, ctx, userId);
  const shas = new Map<string, string>();
  const fileStats = await moveFiles(d, o, plan, { jobs: files, out: shas });
  const tables = await writeUnits(d, o, plan, tid);
  const st = await d.owner.state(tid, o.source);
  const sum = o.apply ? await checksums(d, tid, st, shas) : { ok: 0, bad: 0 };
  const m = money(scope, plan, { tid, st, apply: o.apply });
  return {
    mode: o.apply ? "apply" : "dry-run",
    source: o.source,
    tenant: { key: o.tenantKey, id: tid },
    owner: { email, username: o.ownerUsername, user_id: userId },
    ms: Math.round(d.now() - t0),
    source_orgs: scope.orgs,
    counts: counts(scope, plan, tid, st),
    money: m,
    money_ok: Object.values(m).every((x) => x.ok),
    contracts: contractLines(scope, st, o.source, shas),
    partners: [...companyIndex(scope.snap).values()].map((c) => ({ name: c.name, tax: c.tax })),
    files: { ...fileStats, checksum_ok: sum.ok, checksum_bad: sum.bad },
    tables,
    unmapped_fields: unmappedFields(scope.snap),
    issues_by_code: issues(plan, sum.bad),
    issues_sample: plan.issues.slice(0, 50),
    excluded: o.meta?.excluded ?? scope.excluded,
    not_imported: o.meta?.not_imported ?? scope.not_imported,
  };
}
