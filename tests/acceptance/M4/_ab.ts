// ADM-FR-40, ADM-FR-41, ADM-FR-42, ADM-FR-51, ADM-FR-52 · helper chung cho test int M4 khối A + B (Q2b). Không chứa
// `it(...)`. Schema M4 chưa có trong `@ai/contracts` lúc viết test → tra qua namespace lỏng (`parse4`), ca đỏ ở
// `expect`, `bun run typecheck` vẫn xanh. Mã lỗi mới (NAME_TAKEN…) chưa có trong `ErrorCode` → `expectErr4` nhận chuỗi.
import { expect } from "bun:test";
import * as Contracts from "@ai/contracts";
import { track, verOf } from "../M3/_notify";
import {
  type AuditRow,
  auditMark,
  auditSince,
  type Listener,
  type M4Env,
  num,
  type Res,
} from "./_fixtures";
import type { Loose } from "./_modules";

export * from "./_fixtures";
export { track, verOf };

export const C = Contracts as unknown as Loose;

/** Mã lỗi mới khối A + B (plan-contract §2.5). */
const NEW_AB: Record<string, number> = {
  NAME_TAKEN: 409,
  NOT_RESTORABLE: 409,
  RESTORE_REF_MISSING: 409,
};

/** Như `expectErr` M2 nhưng nhận cả mã mới; trả `details` để kiểm tiếp. */
export function expectErr4(res: Res, code: string): Record<string, unknown> {
  const status = (C.API_ERRORS as Record<string, number>)[code] ?? NEW_AB[code];
  expect(status).toBeDefined();
  expect([code, res.status]).toEqual([code, status as number]);
  expect(res.json?.error?.code).toBe(code);
  const parsed = C.ErrorResponseSchema.safeParse(res.json);
  expect(parsed.success).toBe(true);
  expect(res.headers.get("x-request-id")).toBeTruthy();
  return (res.json?.error?.details ?? {}) as Record<string, unknown>;
}

/** Parse strict bằng schema contract theo tên (`QuotaSetResponseSchema`…); thiếu schema hoặc sai → ném có thông tin. */
export function parse4(name: string, v: unknown): Loose {
  const s = C[name] as Loose | undefined;
  expect([name, s !== undefined]).toEqual([name, true]);
  const r = s?.safeParse(v);
  if (!r?.success)
    throw new Error(`${name}: ${JSON.stringify(r?.error?.issues ?? []).slice(0, 600)}`);
  return r.data;
}

/** Dòng audit `seq > mark`, bỏ dòng do sentinel `env.settle` tạo (group `sentinel-N` của globex). */
export async function audits(env: M4Env, mark: string): Promise<AuditRow[]> {
  return (await auditSince(env.owner, mark)).filter((r) => !r.entity_name.startsWith("sentinel-"));
}

/**
 * `reset4` rồi đặt clock giả của app = giờ thật: `reset` đưa clock về T0 (2026-10-01) nhưng `insertUsage`/`inMonth()`
 * và SQL `now()` theo giờ thật → tháng/khoảng 24 h của app phải cùng mốc với dữ liệu. Token lấy sau lệnh này.
 */
export async function resetNow(env: M4Env): Promise<void> {
  await env.reset4();
  env.clock.set(new Date());
}

export const tenantVer = (env: M4Env, id: string) => verOf(env, "tenants", id);

export const quotaPath = (tenant: string) => `/admin/tenants/${tenant}/quotas`;

export type QItem = {
  feature_id: string | null;
  max_runs: number | null;
  max_tokens: number | null;
  max_usd: string | null;
};
/** Một dòng quota đủ 3 khoá giới hạn (thiếu = null). */
export const qi = (
  feature: string | null,
  l: { runs?: number | null; tokens?: number | null; usd?: string | null },
): QItem => ({
  feature_id: feature,
  max_runs: l.runs ?? null,
  max_tokens: l.tokens ?? null,
  max_usd: l.usd ?? null,
});

/** platform admin PUT quota với version tenant hiện tại (hoặc `version` truyền vào). */
export async function putQuota(
  env: M4Env,
  tenant: string,
  items: QItem[],
  version?: number,
): Promise<Res> {
  const v = version ?? (await tenantVer(env, tenant));
  return env.as("PUT", quotaPath(tenant), { version: v, items });
}

/** Số hàng `quota_alerts` của tenant (owner). */
export const alertRows = (env: M4Env, tenant: string) =>
  env.owner<
    {
      feature_id: string | null;
      level: number;
      status: string;
      attempts: number;
      last_error: string | null;
      pct: number;
    }[]
  >`select feature_id, level, status, attempts, last_error, pct from admin.quota_alerts
    where tenant_id = ${tenant} order by level, feature_id nulls first`;

export const countOf = (env: M4Env, text: string) => num(env.owner, text);

/** Thư tới một địa chỉ (mailer giả). */
export const mailsTo = (env: M4Env, email: string) =>
  env.mailer.sent.filter((m) => m.to.includes(email));

/**
 * Thay `expect.poll` (bun:test chưa có): gọi `fn` tới khi kết quả `toEqual(want)` hoặc hết `ms` (mặc định 5 s), rồi
 * `expect` giá trị cuối (đỏ ở `expect` nếu không đạt). Chờ theo điều kiện, nhịp 50 ms — không phải sleep cố định.
 */
export async function poll<T>(fn: () => T | Promise<T>, want: T, ms = 5000): Promise<void> {
  const end = performance.now() + ms;
  let last = await fn();
  while (!Bun.deepEquals(last, want) && performance.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
    last = await fn();
  }
  expect(last as unknown).toEqual(want);
}

// ---- ghi audit (audit-write*, audit-secrets) ----
export type Who = { tenant: string; user: string };

/** id user theo username + tenant key (owner); id `admin` đổi sau mỗi reset (runSeed). */
export async function userIdOf(env: M4Env, username: string, tenantKey: string): Promise<string> {
  const [r] =
    await env.owner`select u.id from admin.users u join admin.tenants t on t.id = u.tenant_id
    where u.username = ${username} and t.key = ${tenantKey}`;
  return r?.id as string;
}

export type AuditHelpers = ReturnType<typeof auditHelpers>;
/**
 * `audited`: chạy thao tác qua `track` (NOTIFY + sentinel), trả response + dòng audit mới (trừ sentinel); kiểm AW8 —
 * `actor_id`/`actor_username` = người gọi, `config_version` = `v` của NOTIFY (hoặc NULL khi `bump: false`).
 * `one`: như `audited` + 2xx + đúng một dòng khớp `want`.
 */
export function auditHelpers(env: M4Env, lis: Listener) {
  const audited = async (
    who: Who,
    run: () => Promise<Res>,
    o: { bump?: boolean } = {},
  ): Promise<{ res: Res; rows: AuditRow[] }> => {
    await env.token(who.tenant, who.user);
    const mark = await auditMark(env.owner);
    const t = await track(env, lis, run);
    const rows = await audits(env, mark);
    const actor = await userIdOf(env, who.user, who.tenant);
    for (const r of rows) {
      expect([r.entity, r.actor_id, r.actor_username]).toEqual([r.entity, actor, who.user]);
      if (o.bump === false) expect(r.config_version).toBeNull();
      else expect(r.config_version).toBe(t.msgs[0]?.payload.v ?? -1);
    }
    return { res: t.res, rows };
  };
  const one = async (
    who: Who,
    run: () => Promise<Res>,
    want: Partial<AuditRow>,
    o: { bump?: boolean } = {},
  ): Promise<AuditRow> => {
    const { res, rows } = await audited(who, run, o);
    expect([want.action, want.entity, res.status < 300]).toEqual([want.action, want.entity, true]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(want);
    return rows[0] as AuditRow;
  };
  return { audited, one };
}
