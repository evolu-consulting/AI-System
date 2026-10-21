// niti-import · kế hoạch nhập MỘT tài khoản vào MỘT tenant: dùng lại mapper I1 (HĐ + phụ lục + hạng mục + nhắc đã gửi + sổ), mọi
// HĐ thuộc user đích (tra theo username), không ghi danh tính/loại hàng/danh bạ (không xoá được khi hoàn tác). Chia hàng theo HĐ
// (mỗi HĐ một tx) + liệt kê HĐ + trường nguồn không có chỗ ở đích. Thuần.
import { companyIndex } from "./companies.rules";
import type { Ctx, SourceDoc } from "./context";
import { type FileJob, mapContracts, mapReminders } from "./map-contracts.rules";
import { mapLedger } from "./map-ledger.rules";
import type { OwnerScope } from "./owner-scope.rules";
import { newPlan, type Plan, type Row, TABLE_ORDER, type TableName, type TenantPlan } from "./plan";
import { isObj, str } from "./values.rules";

/** Ngữ cảnh: mọi org trong phạm vi ⇒ tenant đích; email chủ cũ ⇒ user đích; người khác ⇒ null (cột NOT NULL ⇒ user đích). */
export function ownerCtx(
  x: { source: string; tenantId: string; ownerEmail: string; ownerId: string },
  issues: Ctx["issues"],
): Ctx {
  const email = x.ownerEmail.trim().toLowerCase();
  return {
    source: x.source,
    tenantOf: (org) => (org ? x.tenantId : null),
    userOf: (_tid, e) => (e && e.toLowerCase() === email ? x.ownerId : null),
    fallbackUser: () => x.ownerId,
    knowledgeOrg: null,
    issues,
  };
}

export function buildOwnerPlan(
  scope: OwnerScope,
  ctx: Ctx,
  ownerId: string,
): { plan: Plan; files: FileJob[] } {
  const s = scope.snap;
  const p = newPlan();
  p.issues = ctx.issues;
  for (const [k, v] of Object.entries(s.docs)) p.read[k] = v.length;
  const orgOfContract = new Map<string, string>();
  for (const d of s.docs.contracts ?? []) {
    const org = str(d.src.org_id, 128);
    if (org) orgOfContract.set(d.id, org);
  }
  const files = mapContracts(s, ctx, p);
  mapReminders(s, ctx, p, orgOfContract);
  mapLedger(s, ctx, p, companyIndex(s));
  for (const t of p.tenants.values())
    for (const r of t.rows["contracts.contracts"] ?? []) {
      // yêu cầu: mọi HĐ nhập thuộc user đích (cả HĐ chưa giao ở app cũ; phụ lục theo HĐ cha)
      r.owner_user_id = ownerId;
      r.created_by = ownerId;
    }
  return { plan: p, files };
}

/** Một đơn vị ghi = một tx: các bảng (thứ tự FK) của MỘT HĐ, hoặc `shared` (sự kiện sổ không gắn HĐ). */
export type Unit = { key: string; tables: [TableName, Row[]][] };

function contractOf(table: TableName, r: Row, ix: Ix): string | null {
  switch (table) {
    case "contracts.contracts":
      return String(r.id);
    case "contracts.files":
      return ix.file.get(String(r.id)) ?? null;
    case "contracts.partner_events":
      return (r.contract_id as string | null) ?? ix.ob.get(String(r.obligation_id ?? "")) ?? null;
    case "contracts.partner_event_voids":
      return ix.ev.get(String(r.mgmt_id)) ?? null;
    default:
      return (r.contract_id as string | null) ?? null;
  }
}

/** Chia hàng của tenant theo HĐ (HĐ cha trước phụ lục — thứ tự `mapContracts`); hàng không gắn HĐ ⇒ đơn vị `shared` cuối. */
type Ix = { file: Map<string, string>; ob: Map<string, string>; ev: Map<string, string> };

/** Tra HĐ của hàng file (theo `file_id` của HĐ), đợt (theo id), sự kiện sổ (theo `mgmt_id`). */
function indexOf(t: TenantPlan, contracts: Row[]): Ix {
  const ix: Ix = {
    file: new Map(contracts.filter((r) => r.file_id).map((r) => [String(r.file_id), String(r.id)])),
    ob: new Map(
      (t.rows["contracts.obligations"] ?? []).map((r) => [String(r.id), String(r.contract_id)]),
    ),
    ev: new Map<string, string>(),
  };
  for (const r of t.rows["contracts.partner_events"] ?? []) {
    const c = contractOf("contracts.partner_events", r, ix);
    if (c) ix.ev.set(String(r.mgmt_id), c);
  }
  return ix;
}

export function unitsOf(t: TenantPlan): Unit[] {
  const contracts = t.rows["contracts.contracts"] ?? [];
  const order = contracts.map((r) => String(r.id));
  const ix = indexOf(t, contracts);
  const known = new Set(order);
  const by = new Map<string, Map<TableName, Row[]>>();
  for (const table of TABLE_ORDER)
    for (const r of t.rows[table] ?? []) {
      const c = contractOf(table, r, ix);
      const key = c && known.has(c) ? c : "shared";
      const m = by.get(key) ?? new Map<TableName, Row[]>();
      m.set(table, [...(m.get(table) ?? []), r]);
      by.set(key, m);
    }
  return [...order, "shared"]
    .filter((k) => by.has(k))
    .map((key) => ({ key, tables: [...(by.get(key) as Map<TableName, Row[]>)] }));
}

const fv = (s: Record<string, unknown>, k: string): unknown =>
  isObj(s.fields) && isObj(s.fields[k]) ? s.fields[k].value : null;

/** Đối tác của HĐ: bên mua của HĐ bán, bên bán của HĐ mua; chưa rõ phía ⇒ "bán → mua". */
export function partnerName(direction: unknown, seller: unknown, buyer: unknown): string | null {
  const s = typeof seller === "string" && seller ? seller : null;
  const b = typeof buyer === "string" && buyer ? buyer : null;
  if (direction === "sale") return b;
  if (direction === "purchase") return s;
  return s || b ? `${s ?? "—"} → ${b ?? "—"}` : null;
}

export type ContractLine = {
  mgmt_id: string;
  kind: string;
  number: string | null;
  title: string | null;
  partner: string | null;
  value: number | null;
  signed_date: unknown;
  start_date: unknown;
  end_date: unknown;
  has_file: boolean;
};

/** Danh sách HĐ nguồn (đối soát tay với app cũ). */
export function sourceContracts(docs: SourceDoc[]): ContractLine[] {
  return docs.map((d) => {
    const s = d.src;
    const total = fv(s, "total_value");
    return {
      mgmt_id: d.id,
      kind: s.kind === "addendum" ? "appendix" : "contract",
      number: str(fv(s, "number"), 200),
      title: str(s.title, 200),
      partner: partnerName(s.direction, fv(s, "supplier_name"), fv(s, "buyer_name")),
      value: typeof total === "number" ? total : null,
      signed_date: fv(s, "signed_date"),
      start_date: fv(s, "start_date"),
      end_date: fv(s, "end_date"),
      has_file: isObj(s.file) && !!str(s.file.name, 255),
    };
  });
}

/** Trường nguồn mà mapper đọc (ngoài các trường này ⇒ "không ánh xạ được"). `fields` giữ nguyên mọi khoá ⇒ không liệt kê. */
const KNOWN: Record<string, Set<string>> = {
  contracts: new Set(
    "id org_id kind parent_id title direction status error owner_email created_by created_at updated_at confirmed_at confirmed_by fields file source_md clauses warnings action_deadline handled items origin cks parties direction_check auto lost_renewal history".split(
      " ",
    ),
  ),
  "contracts.items": new Set(
    "name code spec unit qty unit_price vat_rate moq lead_time_days valid_from valid_to quote verified edited".split(
      " ",
    ),
  ),
  obligations: new Set(
    "id org_id contract_id company_id direction kind seq due_date amount status done_at done_by postponed_to postpones reminders overdue_for source estimated basis created_at updated_at".split(
      " ",
    ),
  ),
  partner_events: new Set(
    "id org_id company_id role type at by source contract_id obligation_id days_late amount note voided voided_by voided_at created_at to was delta criterion value rated_at days_before_expiry with_us due_date party_late kind seq certificate_id".split(
      " ",
    ),
  ),
  // danh bạ: chỉ tên + MST đi vào party_key (bảng contracts.companies không ghi — không xoá được khi hoàn tác)
  companies: new Set(["id", "org_id", "name", "tax_id"]),
};

const present = (v: unknown) =>
  v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);

/** `index.trường` ⇒ số bản ghi có giá trị ở trường mà đích không có chỗ. */
export function unmappedFields(s: OwnerScope["snap"]): Record<string, number> {
  const out: Record<string, number> = {};
  const count = (key: string, src: Record<string, unknown>, known: Set<string>) => {
    for (const [k, v] of Object.entries(src))
      if (!known.has(k) && present(v)) out[`${key}.${k}`] = (out[`${key}.${k}`] ?? 0) + 1;
  };
  for (const ix of ["contracts", "obligations", "partner_events", "companies"])
    for (const d of s.docs[ix] ?? []) count(ix, d.src, KNOWN[ix] as Set<string>);
  for (const d of s.docs.contracts ?? [])
    for (const it of Array.isArray(d.src.items) ? d.src.items : [])
      if (isObj(it)) count("contracts.items", it, KNOWN["contracts.items"] as Set<string>);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
