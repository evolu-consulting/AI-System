// tool-tenant-purge · luật thuần: tham số CLI, phân loại bảng (tenant_id / allowlist / lạ), thứ tự xoá theo FK (con trước cha),
// bẻ vòng (FK cascade/set null bỏ qua; FK nullable ⇒ đặt NULL trước; deferrable ⇒ hoãn), khớp tenant theo uuid/key/tên.
// Không I/O. Phần DB: tenant-purge.db.ts; FileBox: tenant-purge.files.ts; CLI: tenant-purge.ts.

/** Bảng `schema.table` (đã bỏ dấu nháy). */
export type Rel = string;
export type DelAction = "a" | "r" | "c" | "n" | "d"; // pg_constraint.confdeltype
export type Fk = {
  name: string;
  child: Rel;
  parent: Rel;
  cols: string[];
  pcols: string[];
  del: DelAction;
  deferrable: boolean;
  /** Mọi cột FK của con đều nullable. */
  nullable: boolean;
};
export type TableInfo = {
  rel: Rel;
  /** Kiểu cột `tenant_id` (null = không có cột). */
  tenantType: string | null;
  /** Cột khác `tenant_id` có chữ "tenant" trong tên (gợi ý bảng tham chiếu tenant mà không theo chuẩn). */
  tenantLike: string[];
};
/** Bảng không có `tenant_id` nhưng chứa dữ liệu của tenant: xoá theo vị từ tường minh (`$1` = tenant id, `%.` = cột bảng này). */
export type ExtraTable = { rel: Rel; where: string; reason: string };
/** Bảng có cột giống-tenant nhưng KHÔNG chứa dữ liệu riêng tenant (đã xét, ghi lý do). */
export type IgnoredTable = { rel: Rel; reason: string };

export const TENANTS: Rel = "admin.tenants";

/**
 * Allowlist bảng KHÔNG có `tenant_id` mà tham chiếu dữ liệu tenant (FK cascade/no action từ bảng bị xoá). Bảng mới loại này
 * phải được thêm vào đây (kèm vị từ) — nếu không, kế hoạch FAIL (`unknownRefs`), không lặng lẽ bỏ sót.
 */
export const EXTRA_TABLES: readonly ExtraTable[] = [
  {
    rel: "hub.process_def_releases",
    where: "%.def_id in (select d.id from hub.process_defs d where d.tenant_id = $1::uuid)",
    reason:
      "bản phát hành của quy trình riêng tenant (process_defs.tenant_id NULL = thư viện chung, không đụng)",
  },
];

/** Bảng có cột tên giống "tenant" nhưng đã xét là không chứa dữ liệu riêng một tenant. */
export const IGNORED_TABLES: readonly IgnoredTable[] = [
  // CR-124 (hub 0117/0120): hộp thư liên công ty có HAI bên (from_tenant/to_tenant, không có tenant_id). KHÔNG xoá theo vị từ: giữ lịch sử của
  // công ty còn lại, ẩn danh bên bị xoá, chỉ xoá dòng khi cả hai bên đã xoá — `anonymizePartner` (tenant-purge.partner.ts, chạy trước phần xoá).
  { rel: "hub.partner_mailbox", reason: "hai bên: ẩn danh bên bị xoá (tenant-purge.partner.ts)" },
  { rel: "hub.partner_links", reason: "hai bên: ẩn danh bên bị xoá (tenant-purge.partner.ts)" },
  { rel: "hub.partner_email_events", reason: "nhật ký email của hộp thư; xoá cùng dòng hộp thư" },
];

/**
 * Bảng TOÀN HỆ THỐNG (không thuộc tenant) có FK restrict tới bảng có `tenant_id`: hàng của chúng lẽ ra chỉ trỏ vào hàng chung
 * (tenant_id NULL). Không xoá; trước khi xoá kiểm 0 hàng trỏ vào dữ liệu của tenant, có ⇒ FAIL (người vận hành xử lý tay).
 */
export const GUARDED_TABLES: readonly IgnoredTable[] = [
  { rel: "hub.providers", reason: "provider chung; secret_id chỉ trỏ secret chung" },
  { rel: "hub.kh_connections", reason: "kết nối KH chung; secret_id chỉ trỏ secret chung" },
  { rel: "hub.process_slots", reason: "slot mặc định chung; chỉ trỏ quy trình thư viện chung" },
];

export type Plan = {
  /** Thứ tự xoá (con trước cha); `admin.tenants` luôn cuối. */
  order: Rel[];
  /** Vị từ xoá/đếm theo bảng (`$1` = tenant id). */
  where: Record<Rel, string>;
  /** FK trong vòng: đặt NULL các cột này trước khi xoá. */
  preNull: Fk[];
  /** FK deferrable trong vòng: `SET CONSTRAINTS … DEFERRED`. */
  deferred: Fk[];
  /** FK từ bảng ngoài tập xoá trỏ vào tập xoá với ON DELETE SET NULL/DEFAULT (an toàn, chỉ báo). */
  nulledFrom: Fk[];
};

export class PurgeRefused extends Error {
  constructor(msg: string) {
    super(`tenant-purge: ${msg}`);
    this.name = "PurgeRefused";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID.test(s);
export const q = (id: string): string => `"${id.replaceAll('"', '""')}"`;
export const qRel = (rel: Rel): string => {
  const i = rel.indexOf(".");
  return `${q(rel.slice(0, i))}.${q(rel.slice(i + 1))}`;
};

export type PurgeArgs = {
  tenant: string;
  apply: boolean;
  confirm?: string;
  actor?: string;
  state?: string;
  skipFiles: boolean;
};

function flag(args: readonly string[], k: string): string | undefined {
  const i = args.indexOf(k);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) throw new PurgeRefused(`${k} cần giá trị`);
  return v;
}

const KNOWN = new Set(["--tenant", "--apply", "--confirm", "--actor", "--state", "--skip-files"]);

export function parsePurgeArgs(args: readonly string[]): PurgeArgs {
  for (const a of args)
    if (a.startsWith("--") && !KNOWN.has(a)) throw new PurgeRefused(`cờ lạ ${a}`);
  const tenant = flag(args, "--tenant")?.trim();
  if (!tenant) throw new PurgeRefused("cần --tenant <uuid|tên chính xác>");
  const apply = args.includes("--apply");
  const confirm = flag(args, "--confirm");
  if (apply && confirm === undefined)
    throw new PurgeRefused('--apply cần --confirm "<tên tenant chính xác>"');
  return {
    tenant,
    apply,
    confirm,
    actor: flag(args, "--actor"),
    state: flag(args, "--state"),
    skipFiles: args.includes("--skip-files"),
  };
}

export type TenantRow = { id: string; key: string; name: string; platformAdmins: number };

/** Chọn đúng MỘT tenant theo uuid / key / tên chính xác; 0 hoặc >1 ⇒ từ chối. Platform ⇒ từ chối. */
export function pickTenant(rows: readonly TenantRow[], needle: string): TenantRow | null {
  const hits = rows.filter((r) =>
    isUuid(needle)
      ? r.id.toLowerCase() === needle.toLowerCase()
      : r.key === needle || r.name === needle,
  );
  if (hits.length > 1)
    throw new PurgeRefused(
      `"${needle}" khớp ${hits.length} tenant (${hits.map((h) => h.id).join(", ")}) — dùng uuid`,
    );
  const t = hits[0] ?? null;
  if (t && (t.key === "platform" || t.platformAdmins > 0))
    throw new PurgeRefused(`từ chối tenant platform (${t.key}) — nơi giữ platform_admin`);
  return t;
}

export function checkConfirm(t: { name: string }, a: PurgeArgs): void {
  if (a.apply && a.confirm !== t.name)
    throw new PurgeRefused(`--confirm phải đúng tên tenant "${t.name}"`);
}

/** Tập xoá + vị từ. Bảng `tenant_id` kiểu khác uuid ⇒ FAIL (vị từ không chắc đúng). */
export function purgeSet(
  tables: readonly TableInfo[],
  extra: readonly ExtraTable[] = EXTRA_TABLES,
): Record<Rel, string> {
  const where: Record<Rel, string> = {};
  const bad: string[] = [];
  for (const t of tables) {
    if (t.rel === TENANTS || t.tenantType === null) continue;
    if (t.tenantType !== "uuid") bad.push(`${t.rel}.tenant_id:${t.tenantType}`);
    else where[t.rel] = "%.tenant_id = $1::uuid";
  }
  if (bad.length) throw new PurgeRefused(`cột tenant_id không phải uuid: ${bad.join(", ")}`);
  for (const e of extra) where[e.rel] = e.where;
  where[TENANTS] = "%.id = $1::uuid";
  return where;
}

/** Vị từ của bảng với bí danh `alias` (`%.` trong mẫu = cột của bảng này). */
export const whereAs = (tpl: string, alias: string): string => tpl.replaceAll("%.", `${alias}.`);

/**
 * Bảng lạ có thể chứa dữ liệu tenant mà kế hoạch chưa biết ⇒ danh sách lỗi (rỗng = ổn):
 * (a) FK cascade/no action/restrict từ bảng ngoài tập xoá trỏ vào tập xoá; (b) cột giống-tenant ở bảng ngoài tập xoá chưa xét.
 */
export function unknownRefs(
  tables: readonly TableInfo[],
  fks: readonly Fk[],
  where: Record<Rel, string>,
  ignored: readonly IgnoredTable[] = IGNORED_TABLES,
  guarded: readonly IgnoredTable[] = GUARDED_TABLES,
): string[] {
  const out: string[] = [];
  const skip = new Set(ignored.map((i) => i.rel));
  const guard = new Set(guarded.map((g) => g.rel));
  for (const f of fks)
    if (where[f.parent] && !where[f.child] && !guard.has(f.child) && f.del !== "n" && f.del !== "d")
      out.push(`${f.child} (FK ${f.name} → ${f.parent}, on delete ${f.del})`);
  for (const t of tables)
    if (!where[t.rel] && t.tenantLike.length && !skip.has(t.rel))
      out.push(`${t.rel} (cột ${t.tenantLike.join(",")})`);
  return [...new Set(out)].sort();
}

/** Bước Kahn: gỡ các bảng không còn con trỏ vào (con đã xoá) ⇒ thêm vào `order`. */
function drain(nodes: Set<Rel>, edges: Fk[], order: Rel[]): void {
  for (;;) {
    const ready = [...nodes].filter(
      (n) => !edges.some((e) => e.parent === n && nodes.has(e.child)),
    );
    if (ready.length === 0) return;
    for (const n of ready.sort()) {
      order.push(n);
      nodes.delete(n);
    }
  }
}

/** Thứ tự xoá con trước cha. Vòng: bỏ FK cascade/set null; rồi FK nullable ⇒ preNull; deferrable ⇒ deferred; còn lại ⇒ FAIL. */
export function orderTables(where: Record<Rel, string>, fks: readonly Fk[]): Plan {
  const nodes = new Set(Object.keys(where).filter((r) => r !== TENANTS));
  let edges = fks.filter((f) => f.child !== f.parent && nodes.has(f.child) && nodes.has(f.parent));
  const order: Rel[] = [];
  const preNull: Fk[] = [];
  const deferred: Fk[] = [];
  drain(nodes, edges, order);
  const breakers: ((f: Fk) => boolean)[] = [
    (f) => f.del === "c" || f.del === "n" || f.del === "d",
    (f) => f.nullable,
    (f) => f.deferrable,
  ];
  for (const [i, can] of breakers.entries()) {
    if (nodes.size === 0) break;
    const cut = edges.filter((e) => nodes.has(e.child) && nodes.has(e.parent) && can(e));
    if (i === 1) preNull.push(...cut);
    if (i === 2) deferred.push(...cut);
    edges = edges.filter((e) => !cut.includes(e));
    drain(nodes, edges, order);
  }
  if (nodes.size)
    throw new PurgeRefused(
      `không xếp được thứ tự xoá (vòng FK không hoãn được): ${[...nodes].sort().join(", ")}`,
    );
  const nulledFrom = fks.filter(
    (f) => where[f.parent] && !where[f.child] && (f.del === "n" || f.del === "d"),
  );
  return { order: [...order, TENANTS], where, preNull, deferred, nulledFrom };
}

/** Mọi bảng `tenant_id` phải có chỗ trong thứ tự — sót ⇒ FAIL (bảng mới không bị lặng lẽ bỏ qua). */
export function assertCovered(tables: readonly TableInfo[], plan: Plan): void {
  const inOrder = new Set(plan.order);
  const miss = tables.filter((t) => t.tenantType !== null && !inOrder.has(t.rel)).map((t) => t.rel);
  if (miss.length)
    throw new PurgeRefused(`bảng tenant_id không có trong thứ tự xoá: ${miss.join(", ")}`);
}

export type Counts = Record<Rel, number>;

/** Dòng in: chỉ bảng có hàng, xếp theo thứ tự xoá; cuối là tổng. */
export function describeCounts(order: readonly Rel[], counts: Counts, verb: string): string[] {
  const lines = order.filter((r) => (counts[r] ?? 0) > 0).map((r) => `  ${verb} ${counts[r]} ${r}`);
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  return [...lines, `  tổng ${total} hàng / ${lines.length} bảng`];
}

/** `fb/<id>` ⇒ `<id>`; chuỗi khác (đường dẫn local `<tenant>/<id>`) ⇒ null. */
export function fileboxIdOf(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.startsWith("fb/")) return v.slice(3) || null;
  return null;
}

/** Cột chứa id FileBox: `file_id`, `*_file_id`, `filebox_file_id` (text/uuid); `storage_key` (giá trị `fb/<id>`). */
export function isFileColumn(name: string, type: string): "id" | "locator" | null {
  if (!["text", "uuid", "character varying"].includes(type)) return null;
  if (/(^|_)file_id$/.test(name)) return "id";
  if (name === "storage_key") return "locator";
  return null;
}

export const orgForTenant = (tenantId: string): string => `t_${tenantId}`;
