// I1 · hợp đồng mgmt-app (index `contracts`, `catalogs`, `state` remind:*) ⇒ contracts.contracts/contract_items/
// contract_categories/contract_events/contract_reminders/visibility_settings + việc file. Trường trích xuất giữ nguyên dạng
// `{value, quote, verified, edited}` (cột sinh đọc `fields->x->>'value'`). Phụ lục (`addendum`) ⇒ `appendix`, chủ = chủ HĐ cha
// (D-M1-03). Nhắc đã gửi ⇒ `contract_reminders` để vòng nhắc HD4 không gửi lại. Thuần.
import { type Ctx, docsOf, idOf, type Snapshot, type SourceDoc } from "./context";
import { addMoney, bump, type Plan, push, type Row, type TenantPlan, tenantPlan } from "./plan";
import { bool, day, int, isObj, jsonSafe, lowerEmail, money, num, str, ts } from "./values.rules";

const STATUSES = new Set([
  "extracting",
  "extract_failed",
  "needs_review",
  "active",
  "expiring",
  "expired",
  "renewed",
  "terminated",
]);
const OUTCOMES = new Set(["renewed", "not_renewed", "negotiating", "replaced"]);

/** ≡ mgmt `ingest/resolve.py::match_form`: NFD, bỏ dấu kết hợp, thường, trim (đ giữ nguyên). */
export const matchForm = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** ≡ mgmt `contracts/project.py::product_key`. */
export function productKey(
  code: string | null,
  name: string,
  spec: string | null,
  org: string,
): string {
  return code
    ? `${org}|code:${matchForm(code)}`
    : `${org}|name:${matchForm(name)}|${matchForm(spec ?? "")}`;
}

/** Việc file của một HĐ: bytes đọc ở `<org>/<contract>/` dưới `contract_files`, ghi vào FileBox/thư mục rồi gắn `file_id`. */
export type FileJob = {
  tenantId: string;
  contractId: string;
  fileRowId: string;
  dir: string;
  name: string;
  mime: string;
  createdBy: string;
};

/** Loại hàng theo org: product key ⇒ tên loại (theo alias `into` nếu có). */
type CategoryIndex = Map<string, Map<string, string>>;

const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);
const text = (r: Record<string, unknown>, k: string): string | null =>
  typeof r[k] === "string" ? (r[k] as string) : null;

/** Loại của một org ⇒ hàng contract_categories (gộp tên trùng không phân biệt hoa thường); trả id mgmt ⇒ tên. */
function catalogCategories(
  src: Record<string, unknown>,
  t: TenantPlan,
  ctx: Ctx,
  org: string,
): Map<string, string> {
  const names = new Map<string, string>();
  const seen = new Set<string>();
  for (const c of list(src.categories)) {
    const name = str(c.name, 40);
    const cid = str(c.id, 128);
    if (!name || !cid) continue;
    names.set(cid, name);
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    push(t, "contracts.contract_categories", { id: idOf(ctx, "category", `${org}|${cid}`), name });
  }
  return names;
}

/** product key ⇒ tên loại (gán trực tiếp, hoặc qua alias `into`). */
function productCategories(
  src: Record<string, unknown>,
  names: Map<string, string>,
): Map<string, string> {
  const byProduct = new Map<string, string>();
  for (const a of list(src.assign)) {
    const name = names.get(text(a, "category") ?? "");
    const product = text(a, "product");
    if (name && product) byProduct.set(product, name);
  }
  for (const a of list(src.aliases)) {
    const [from, into] = [text(a, "product"), text(a, "into")];
    const name = into ? byProduct.get(into) : undefined;
    if (from && name && !byProduct.has(from)) byProduct.set(from, name);
  }
  return byProduct;
}

function mapCatalogs(s: Snapshot, ctx: Ctx, p: Plan): CategoryIndex {
  const out: CategoryIndex = new Map();
  for (const d of docsOf(s, "catalogs")) {
    const org = str(d.src.org_id, 128) ?? d.id;
    const tid = ctx.tenantOf(org);
    if (!tid) continue;
    const names = catalogCategories(d.src, tenantPlan(p, tid, org), ctx, org);
    out.set(org, productCategories(d.src, names));
  }
  return out;
}

/** `fields` đích: mỗi trường `{value, quote ≤2000, verified, edited}`; tổng giá trị không nguyên ⇒ null + vấn đề. */
function mapFields(raw: unknown, ctx: Ctx, ref: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isObj(raw)) return out;
  for (const [k, f] of Object.entries(raw)) {
    if (!isObj(f)) continue;
    let value = f.value ?? null;
    if (k === "total_value") value = money(value, ctx.issues, "contract", ref);
    if (typeof value === "string") value = str(value, 2000);
    out[k] = {
      value,
      quote: str(f.quote, 2000) ?? "",
      verified: bool(f.verified),
      edited: bool(f.edited),
    };
  }
  return out;
}

function contractRow(d: SourceDoc, ctx: Ctx, tid: string, parentOwner: string | null): Row {
  const s = d.src;
  const ref = `contracts/${d.id}`;
  const fields = mapFields(s.fields, ctx, ref);
  let status = typeof s.status === "string" && STATUSES.has(s.status) ? s.status : "needs_review";
  if (status !== s.status) ctx.issues.push({ entity: "contract", ref, code: "STATUS_MAPPED" });
  // M3: trích HĐ = job Redis do lúc tải lên xếp; HĐ đang đọc dở ở mgmt-app không có job ⇒ kẹt. Đánh dấu lỗi để người dùng trích lại.
  const interrupted = status === "extracting";
  if (interrupted) status = "extract_failed";
  const handled = isObj(s.handled) && OUTCOMES.has(String(s.handled.outcome)) ? s.handled : null;
  const fv = (k: string) => (isObj(fields[k]) ? (fields[k] as { value: unknown }).value : null);
  return {
    id: idOf(ctx, "contract", d.id),
    kind: "contract",
    parent_id: null,
    title: str(s.title, 200) ?? str(fv("number"), 200) ?? "Hợp đồng",
    direction: s.direction === "sale" || s.direction === "purchase" ? s.direction : null,
    status,
    error: interrupted ? "MGMT_IMPORT_INTERRUPTED" : str(s.error, 2000),
    owner_user_id: parentOwner ?? ctx.userOf(tid, lowerEmail(s.owner_email)),
    created_by: ctx.userOf(tid, lowerEmail(s.created_by)) ?? ctx.fallbackUser(tid),
    created_at: ts(s.created_at),
    updated_at: ts(s.updated_at),
    confirmed_at: ts(s.confirmed_at),
    confirmed_by: ctx.userOf(tid, lowerEmail(s.confirmed_by)),
    fields,
    file_id: null,
    source_text: str(s.source_md, 5_000_000),
    clauses: jsonSafe(Array.isArray(s.clauses) ? s.clauses : []),
    warnings: jsonSafe(Array.isArray(s.warnings) ? s.warnings : []),
    action_deadline: day(s.action_deadline),
    handled: jsonSafe(handled),
    run_id: idOf(ctx, "approval", d.id),
  };
}

/** Ngữ cảnh của một hạng mục: HĐ cha, loại hàng của org, chỗ ghi vấn đề. */
type ItemCtx = {
  ctx: Ctx;
  contractId: string;
  cats: Map<string, string> | undefined;
  org: string;
  ref: string;
};

function itemRow(it: Record<string, unknown>, ord: number, x: ItemCtx): Row | null {
  const { ctx, contractId, cats, org, ref } = x;
  const name = str(it.name, 500);
  if (!name) {
    ctx.issues.push({ entity: "item", ref: `${ref}/items[${ord}]`, code: "ITEM_NO_NAME" });
    return null;
  }
  const code = str(it.code, 100);
  const spec = str(it.spec, 2000);
  return {
    id: idOf(ctx, "item", `${contractId}|${ord}`),
    contract_id: contractId,
    ord,
    code,
    name,
    spec,
    unit: str(it.unit, 50),
    qty: num(it.qty, -1e14, 1e14),
    unit_price: money(it.unit_price, ctx.issues, "item", `${ref}/items[${ord}]`),
    vat_rate: num(it.vat_rate, 0, 100),
    moq: num(it.moq, -1e14, 1e14),
    lead_time_days: int(it.lead_time_days, 0, 3650),
    valid_from: day(it.valid_from),
    valid_to: day(it.valid_to),
    category_name: cats?.get(productKey(code, name, spec, org)) ?? null,
    quote: str(it.quote, 2000),
    verified: bool(it.verified),
    edited: bool(it.edited),
  };
}

/** Dữ liệu phụ không có cột riêng ⇒ một sự kiện `mgmt_import` (≤ 64 KB; lịch sử sửa cắt nếu quá). */
function importEvent(d: SourceDoc, contractId: string, source: string): Row {
  const s = d.src;
  const data: Record<string, unknown> = {
    mgmt_id: d.id,
    // niti-import: nhãn lô nhập (= `--source`) — hoàn tác chỉ xoá HĐ mang nhãn này
    mgmt_source: source,
    origin: s.origin ?? null,
    cks: s.cks ?? null,
    parties: s.parties ?? null,
    direction_check: s.direction_check ?? null,
    auto: s.auto ?? null,
    lost_renewal: s.lost_renewal ?? null,
    file: s.file ?? null,
    history: Array.isArray(s.history) ? s.history.slice(-50) : [],
  };
  if (JSON.stringify(data).length > 60_000) data.history = [];
  return {
    contract_id: contractId,
    type: "mgmt_import",
    at: ts(s.created_at),
    data: jsonSafe(data),
  };
}

function fileJob(d: SourceDoc, t: TenantPlan, ctx: Ctx, row: Row): FileJob | null {
  const f = isObj(d.src.file) ? d.src.file : null;
  const name = f ? str(f.name, 255) : null;
  if (!f || !name) return null;
  return {
    tenantId: t.tenantId,
    contractId: row.id as string,
    fileRowId: idOf(ctx, "file", d.id),
    dir: `${t.orgId}/${d.id}`,
    name,
    mime: str(f.mime, 128) ?? "application/octet-stream",
    createdBy: row.created_by as string,
  };
}

/** Bộ chung khi ánh xạ HĐ: ngữ cảnh, loại hàng theo org, chủ HĐ đã chuyển (cho phụ lục), việc file. */
type CMap = { ctx: Ctx; cats: CategoryIndex; owners: Map<string, string | null>; files: FileJob[] };

function mapItems(d: SourceDoc, t: TenantPlan, m: CMap, contractId: string): void {
  const x: ItemCtx = {
    ctx: m.ctx,
    contractId,
    cats: m.cats.get(t.orgId),
    org: t.orgId,
    ref: `contracts/${d.id}`,
  };
  const items = Array.isArray(d.src.items) ? d.src.items.slice(0, 10_000) : [];
  items.forEach((it, i) => {
    const r = isObj(it) ? itemRow(it, i, x) : null;
    if (!r) return;
    push(t, "contracts.contract_items", r);
    addMoney(t, "items.unit_price", r.unit_price as number | null);
  });
}

/** Phụ lục: cha phải đã chuyển (nếu không ⇒ thành HĐ thường + PARENT_MISSING); chủ phụ lục = chủ cha. */
function parentOf(
  d: SourceDoc,
  ctx: Ctx,
  owners: Map<string, string | null>,
): { id: string; owner: string | null } | null {
  const mgmt = d.src.kind === "addendum" ? str(d.src.parent_id, 128) : null;
  if (!mgmt) return null;
  const id = idOf(ctx, "contract", mgmt);
  if (owners.has(id)) return { id, owner: owners.get(id) ?? null };
  ctx.issues.push({ entity: "contract", ref: `contracts/${d.id}`, code: "PARENT_MISSING" });
  return null;
}

/** M3 · trạng thái HĐ ⇒ lượt duyệt `contracts.approvals` (cùng luật migration 0011_m3_approvals): đã duyệt ⇒ done (người xác
 *  nhận = cấp 1 + người quyết), bị từ chối ⇒ rejected, trích lỗi ⇒ failed, chờ xem lại ⇒ level1 (lượt sống). `contracts.run_id`
 *  = id lượt. `migrated = true` (lượt không đi qua máy trạng thái). */
export function approvalRow(c: Row): Row {
  const s = String(c.status);
  const status = ["active", "expiring", "expired", "renewed", "terminated"].includes(s)
    ? "done"
    : s === "rejected"
      ? "rejected"
      : s === "extract_failed"
        ? "failed"
        : "level1";
  const done = status === "done";
  return {
    id: c.run_id,
    contract_id: c.id,
    status,
    started_by: c.created_by,
    level1_by: done ? c.confirmed_by : null,
    level1_at: done ? c.confirmed_at : null,
    decided_by: done ? c.confirmed_by : null,
    decided_at: done ? c.confirmed_at : null,
    created_at: c.created_at,
    updated_at: c.updated_at ?? c.created_at,
  };
}

function mapOne(d: SourceDoc, t: TenantPlan, m: CMap): void {
  const { ctx, owners, files } = m;
  const parent = parentOf(d, ctx, owners);
  const row = contractRow(d, ctx, t.tenantId, parent?.owner ?? null);
  if (parent) Object.assign(row, { kind: "appendix", parent_id: parent.id });
  push(t, "contracts.contracts", row);
  push(t, "contracts.approvals", approvalRow(row));
  const total = (row.fields as Record<string, { value?: unknown } | undefined>).total_value?.value;
  addMoney(t, "contracts.total_value", typeof total === "number" ? total : null);
  mapItems(d, t, m, row.id as string);
  push(t, "contracts.contract_events", importEvent(d, row.id as string, ctx.source));
  const job = fileJob(d, t, ctx, row);
  if (job) files.push(job);
}

/** HĐ cha trước phụ lục (FK + chủ phụ lục = chủ cha). */
export function mapContracts(s: Snapshot, ctx: Ctx, p: Plan): FileJob[] {
  const m: CMap = { ctx, cats: mapCatalogs(s, ctx, p), owners: new Map(), files: [] };
  const { owners, files } = m;
  const all = docsOf(s, "contracts");
  const sorted = [
    ...all.filter((d) => d.src.kind !== "addendum"),
    ...all.filter((d) => d.src.kind === "addendum"),
  ];
  for (const d of sorted) {
    const org = str(d.src.org_id, 128);
    const tid = ctx.tenantOf(org);
    if (!tid || !org) {
      bump(p.noTenant, "contracts");
      continue;
    }
    const t = tenantPlan(p, tid, org);
    mapOne(d, t, m);
    const last = t.rows["contracts.contracts"]?.at(-1) as Row;
    owners.set(last.id as string, (last.owner_user_id as string | null) ?? null);
  }
  return files;
}

/** Khoá `remind:{hđ}:{hạn}:{mốc}:{email}` ⇒ phần; hạn không phải ngày (mốc giá `price-…`) ⇒ null. */
export function parseRemindKey(
  id: string,
): { contract: string; deadline: string; milestone: number; email: string } | null {
  if (!id.startsWith("remind:")) return null;
  const parts = id.slice(7).split(":");
  const email = lowerEmail(parts.at(-1));
  const milestone = int(parts.at(-2), -3650, 3650);
  const deadline = day(parts.at(-3));
  if (parts.length < 4 || !email || milestone === null || !deadline) return null;
  return { contract: parts.slice(0, -3).join(":"), deadline, milestone, email };
}

/** `state` remind:* ⇒ contract_reminders (khoá idempotent của HD4: vòng nhắc không gửi lại nhắc đã gửi ở mgmt-app). */
export function mapReminders(
  s: Snapshot,
  ctx: Ctx,
  p: Plan,
  orgOfContract: Map<string, string>,
): void {
  for (const d of docsOf(s, "state")) {
    const k = parseRemindKey(d.id);
    const org = k ? orgOfContract.get(k.contract) : undefined;
    const tid = org ? ctx.tenantOf(org) : null;
    const user = k && tid ? ctx.userOf(tid, k.email) : null;
    if (!k || !org || !tid || !user) continue;
    const v = isObj(d.src.value) ? d.src.value : {};
    push(tenantPlan(p, tid, org), "contracts.contract_reminders", {
      contract_id: idOf(ctx, "contract", k.contract),
      deadline: k.deadline,
      milestone: k.milestone,
      user_id: user,
      channel: "mgmt_import",
      sent_at: ts(v.at),
    });
  }
}
