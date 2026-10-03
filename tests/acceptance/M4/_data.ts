// ADM-FR-40, ADM-FR-41, ADM-FR-42, ADM-FR-51 · dữ liệu fixture M4 khối A + B (test-plan §1, §2). Dùng chung cho test int
// (bun) và e2e/support (Node/Playwright): chỉ phụ thuộc `postgres`, KHÔNG import bun:test. Khối C + D chỉ thêm export.
// Bẫy (CONVENTIONS §2): jsonb qua `sql.json`; `audit_log` KHÔNG TRUNCATE/DELETE được (trigger, kể cả owner) → mỗi ca lấy
// mốc `auditMark` đầu ca và chỉ đếm `seq > mark`; tên dữ liệu audit seed nên mang tiền tố riêng của ca (`ar-{mark}-`).
import type postgres from "postgres";
import {
  ID,
  ID3,
  id3,
  LEAK_1,
  LEAK_2,
  leakForms,
  newField,
  num,
  TENANT_ID,
  USER_ID,
} from "../M3/_data";

export { ID, ID3, id3, LEAK_1, LEAK_2, leakForms, newField, num, TENANT_ID, USER_ID };

type Sql = postgres.Sql;

const pad2 = (n: number): string => String(n).padStart(2, "0");
/** uuid cố định `01900000-0000-7000-8000-0000000004nn` (nn thập phân 00–99). */
export const id4 = (n: number): string => `01900000-0000-7000-8000-0000000004${pad2(n)}`;
/** run_id của hàng usage thứ `i` (≥ 0): `01900000-0000-7000-8004-{i 12 số}`. */
export const runId = (i: number): string =>
  `01900000-0000-7000-8004-${String(i).padStart(12, "0")}`;

export const ID4 = {
  /** uuid hợp lệ nhưng không có trong DB. */
  unknown: id4(99),
} as const;

// ---- thời gian (M4-R01: tháng theo giờ VN = UTC+7, không DST) ----
const VN_MS = 7 * 3600_000;

/** Mốc 00:00 ngày 1 (giờ VN) của tháng chứa `d`, ra UTC. `addMonths` dịch tháng (âm = trước). */
export function vnMonthStart(d: Date, addMonths = 0): Date {
  const vn = new Date(d.getTime() + VN_MS);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() + addMonths, 1) - VN_MS);
}

/** "YYYY-MM" (giờ VN) của `d`. */
export function vnMonth(d: Date): string {
  const vn = new Date(d.getTime() + VN_MS);
  return `${vn.getUTCFullYear()}-${pad2(vn.getUTCMonth() + 1)}`;
}

/** "YYYY-MM-DD" (giờ VN) của `d`. */
export function vnDate(d: Date): string {
  const vn = new Date(d.getTime() + VN_MS);
  return `${vn.getUTCFullYear()}-${pad2(vn.getUTCMonth() + 1)}-${pad2(vn.getUTCDate())}`;
}

/** Thời điểm chắc chắn trong tháng hiện tại (VN): now − 1 phút; nếu < 10 phút từ đầu tháng thì đầu tháng + 1 s. */
export function inMonth(now: Date = new Date()): Date {
  const start = vnMonthStart(now);
  if (now.getTime() - start.getTime() < 10 * 60_000) return new Date(start.getTime() + 1000);
  return new Date(now.getTime() - 60_000);
}

/** Thời điểm chắc chắn trong tháng trước (VN): giữa tháng trước. */
export function inPrevMonth(now: Date = new Date()): Date {
  return new Date(vnMonthStart(now, -1).getTime() + 14 * 86_400_000);
}

// ---- usage (vai Hub: owner ghi hub.usage_logs; admin_rw chỉ SELECT) ----
export type UsageOpts = {
  tenant: string;
  /** feature_id; vắng/null = run không theo feature. */
  feature?: string | null;
  user?: string | null;
  at?: Date;
  /** chuỗi thập phân; null = chưa định giá (R07). Mặc định "0.10". */
  billable?: string | null;
  /** Mặc định "0.06". */
  cost?: string | null;
  /** true = mọi hàng; số k = hàng có chỉ số (0-based trong lần gọi) ≥ k mang overage. */
  overage?: boolean | number;
  input?: number;
  output?: number;
  /** chỉ số run_id đầu tiên; mặc định = số hàng hiện có (ổn định sau reset). */
  runFrom?: number;
};

/** owner chèn `n` hàng `hub.usage_logs`, 1 run_id/hàng, in 100/out 50, billable 0.10, cost 0.06, at = `inMonth()`. */
export async function insertUsage(sql: Sql, n: number, o: UsageOpts): Promise<void> {
  if (n <= 0) return;
  const from = o.runFrom ?? (await num(sql, "select count(*)::int as n from hub.usage_logs"));
  const at = o.at ?? inMonth();
  const rows = Array.from({ length: n }, (_, i) => ({
    tenant_id: o.tenant,
    run_id: runId(from + i),
    user_id: o.user ?? null,
    feature_id: o.feature ?? null,
    billing: "api",
    input_tokens: o.input ?? 100,
    output_tokens: o.output ?? 50,
    cost_usd: o.cost === undefined ? "0.06" : o.cost,
    billable_usd: o.billable === undefined ? "0.10" : o.billable,
    overage: typeof o.overage === "number" ? i >= o.overage : (o.overage ?? false),
    at,
  }));
  for (let i = 0; i < rows.length; i += 2000) {
    await sql`insert into hub.usage_logs ${sql(rows.slice(i, i + 2000))}`;
  }
}

/** Xoá toàn bộ usage (reset mỗi ca; bảng Hub không bị TRUNCATE CASCADE theo tenants). */
export async function clearUsage(sql: Sql): Promise<void> {
  await sql`delete from hub.usage_logs`;
}

export type Limits = { runs?: number | null; tokens?: number | null; usd?: string | null };

/** owner chèn một hàng `tenant_quotas` (dựng nhanh khi không kiểm PUT). `feature` null = cả tenant. */
export async function setQuota(
  sql: Sql,
  tenant: string,
  feature: string | null,
  l: Limits,
): Promise<void> {
  await sql`insert into admin.tenant_quotas (tenant_id, feature_id, max_runs, max_tokens, max_usd)
    values (${tenant}, ${feature}, ${l.runs ?? null}, ${l.tokens ?? null}, ${l.usd ?? null})`;
}

// ---- audit (append-only) ----
export type AuditRow = {
  seq: string;
  id: string;
  tenant_id: string | null;
  actor_id: string | null;
  actor_username: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  entity_name: string;
  config_version: number | null;
  entity_version: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  summary: Record<string, unknown>;
  snapshot: boolean;
};

/** Mốc `max(seq)` (chuỗi bigint; "0" khi rỗng) — lấy đầu mỗi ca. */
export async function auditMark(sql: Sql): Promise<string> {
  const [r] = await sql<
    { m: string }[]
  >`select coalesce(max(seq), 0)::text as m from admin.audit_log`;
  return r?.m ?? "0";
}

/** Các dòng audit `seq > mark`, sắp seq tăng. */
export async function auditSince(sql: Sql, mark: string): Promise<AuditRow[]> {
  return sql<
    AuditRow[]
  >`select seq::text as seq, id, tenant_id, actor_id, actor_username, action, entity,
      entity_id, entity_name, config_version, entity_version, before, after, summary, snapshot
    from admin.audit_log where seq > ${mark}::bigint order by seq`;
}

export type SeedAuditOpts = {
  /** tiền tố `entity_name` (mặc định `m4-page-`); tên = tiền tố + NN (2 chữ số từ 01). */
  prefix?: string;
  tenantId?: string | null;
  action?: string;
  entity?: string;
  entityId?: string | null;
};

/** owner chèn `n` dòng audit (phân trang/lọc); trả các `entity_name` theo thứ tự chèn. */
export async function seedAuditRows(sql: Sql, n: number, o: SeedAuditOpts = {}): Promise<string[]> {
  const prefix = o.prefix ?? "m4-page-";
  const names = Array.from({ length: n }, (_, i) => `${prefix}${pad2(i + 1)}`);
  for (const name of names) {
    await sql`insert into admin.audit_log (tenant_id, action, entity, entity_id, entity_name, summary)
      values (${o.tenantId ?? null}, ${o.action ?? "update"}, ${o.entity ?? "group"},
        ${o.entityId ?? null}, ${name}, ${sql.json({})})`;
  }
  return names;
}
