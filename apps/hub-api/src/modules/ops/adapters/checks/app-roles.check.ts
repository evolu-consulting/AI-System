// CR-121 c19 (D2) · ops-checks · "Vai theo ứng dụng" (`app_roles`): hai tầng vai khác nghĩa phải nhất quán, bắt lệch TỰ ĐỘNG.
// Vai hub = `admin.users.role` (platform_admin | tenant_admin | member). Vai theo app = `admin.app_roles` (biên dịch ra Group + grant).
// App của feature đọc từ CỘT `admin.features.app` (c18) — không suy từ tiền tố khoá; mức của feature = hậu tố `-read|-write|-admin`.
// Quy tắc (spec CR-121 D2):
//  1. (lỗi) `tenant_admin` hoạt động phải có mức Quản trị (grant trực tiếp hoặc qua Group trên feature `-admin` của app) ở MỌI app công ty đang bật
//     ở mức Quản trị (công ty chỉ có trần thấp hơn thì không thể có ⇒ không tính).
//  2. (cảnh báo) `member` không có grant vượt trần mức của app ở công ty (trần = mức cao nhất có entitlement còn hiệu lực; app tắt ⇒ 0).
//     Giữ cảnh báo tới khi xác minh bằng dữ liệu thật rồi mới nâng lỗi.
//  3. (lỗi) `app_roles.key` không trùng tên vai hub (so khớp `-` ≡ `_`).
//  4. (lỗi) thành viên Group của vai app phải thuộc đúng công ty của Group.
//  5. (lỗi) không có `app_roles` cho app công ty không bật (không còn entitlement nào của app).
// Một câu SQL tập hợp (Luật 4c), không lặp theo tenant: mỗi quy tắc là một nhánh `viol`, gom `count` + 5 mẫu.
import { sql } from "drizzle-orm";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { systemRead } from "./check-kit";

export type AppRoleRule = 1 | 2 | 3 | 4 | 5;
export type AppRolesRow = { rule: AppRoleRule; n: number; sample: string[] };

const SAMPLES = 5;

const RULES: Record<AppRoleRule, { error: boolean; what: string; fix: string }> = {
  1: {
    error: true,
    what: "quản trị công ty (tenant_admin) chưa có mức Quản trị ở app đang bật",
    fix: "Admin › Công ty › Ứng dụng: cho tenant_admin vào vai Quản trị (owner) của app.",
  },
  2: {
    error: false,
    what: "thành viên (member) có quyền vượt trần mức của app ở công ty",
    fix: "Hạ vai của thành viên hoặc nâng mức app của công ty (cảnh báo, chưa chặn).",
  },
  3: {
    error: true,
    what: "mã vai app trùng tên vai hệ thống (platform_admin/tenant_admin/member)",
    fix: "Đổi mã vai app (Admin › Công ty › Ứng dụng › Vai).",
  },
  4: {
    error: true,
    what: "thành viên vai app thuộc công ty khác với công ty của nhóm",
    fix: "Gỡ thành viên khỏi nhóm vai (dữ liệu sai cách ly công ty — báo kỹ thuật).",
  },
  5: {
    error: true,
    what: "vai app thuộc app công ty không bật",
    fix: "Xoá vai app đó hoặc bật lại app cho công ty.",
  },
};

/** Thuần. Lỗi (1,3,4,5) ⇒ crit; chỉ có cảnh báo (2) ⇒ warn; sạch ⇒ ok. */
export function evaluateAppRoles(rows: readonly AppRolesRow[]): OpsCheckResult {
  const by = new Map(rows.filter((r) => r.n > 0).map((r) => [r.rule, r]));
  const value = Object.fromEntries(
    ([1, 2, 3, 4, 5] as const).map((k) => [`rule${k}`, by.get(k)?.n ?? 0]),
  );
  if (by.size === 0)
    return { status: "ok", value, message: "Vai hub và vai theo app nhất quán (5 quy tắc)" };
  const parts = [...by.values()]
    .sort((a, b) => a.rule - b.rule)
    .map(
      (r) =>
        `[${r.rule}] ${r.n} ${RULES[r.rule].what}: ${r.sample.slice(0, SAMPLES).join(", ")}${r.n > r.sample.length ? ` và ${r.n - r.sample.length} nữa` : ""}`,
    );
  const hasError = [...by.keys()].some((k) => RULES[k].error);
  return {
    status: hasError ? "crit" : "warn",
    value,
    message: parts.join(" · "),
    hint: [...by.keys()]
      .sort()
      .map((k) => RULES[k].fix)
      .join(" "),
  };
}

/**
 * Một câu, văn bản cố định. `lv` = feature có mức (app theo CỘT, mức theo hậu tố); `ceil` = trần mức mỗi (công ty, app) từ entitlement
 * còn hiệu lực; `gr` = grant hiệu lực theo (công ty, user, app, mức) — trực tiếp ∪ qua Group; `viol` = nhánh từng quy tắc.
 */
export const appRolesQuery = () => sql`
  with tt as (select id, active, coalesce(nullif(name, ''), key) as name from admin.tenants),
  lv as (
    select f.id, f.app, case substring(f.key from '-(read|write|admin)$')
        when 'read' then 1 when 'write' then 2 else 3 end as lvl
    from admin.features f
    where f.app not in ('core', 'other') and f.key ~ '-(read|write|admin)$' and f.status <> 'off'),
  ceil as (
    select e.tenant_id, lv.app, max(lv.lvl) as c from admin.feature_entitlements e join lv on lv.id = e.feature_id
    where e.revoked_at is null group by e.tenant_id, lv.app),
  onapp as (
    select distinct e.tenant_id, f.app from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
    where e.revoked_at is null and f.status <> 'off' and f.app not in ('core', 'other')),
  gr as (
    select fg.tenant_id, fg.user_id, lv.app, lv.lvl from admin.feature_grants fg join lv on lv.id = fg.feature_id
    where fg.user_id is not null
    union
    select fg.tenant_id, gm.user_id, lv.app, lv.lvl from admin.feature_grants fg join lv on lv.id = fg.feature_id
    join admin.group_members gm on gm.group_id = fg.group_id and gm.tenant_id = fg.tenant_id
    where fg.group_id is not null),
  viol as (
    select 1 as rule, tt.name || ' · ' || u.username || ' (' || c.app || ')' as label
    from admin.users u join tt on tt.id = u.tenant_id and tt.active
    join ceil c on c.tenant_id = u.tenant_id and c.c = 3
    where u.role = 'tenant_admin' and u.active and not u.locked_by_tenant and u.kind = 'internal'
      and not exists (select 1 from gr where gr.tenant_id = u.tenant_id and gr.user_id = u.id and gr.app = c.app and gr.lvl = 3)
    union all
    select 2, tt.name || ' · ' || u.username || ' (' || g.app || ')'
    from (select distinct tenant_id, user_id, app, lvl from gr) g
    join admin.users u on u.id = g.user_id and u.tenant_id = g.tenant_id
    join tt on tt.id = u.tenant_id and tt.active
    left join ceil c on c.tenant_id = g.tenant_id and c.app = g.app
    where u.role = 'member' and u.active and g.lvl > coalesce(c.c, 0)
    union all
    select 3, tt.name || ' · ' || ar.pack || '/' || ar.key
    from admin.app_roles ar join tt on tt.id = ar.tenant_id
    where replace(ar.key, '-', '_') in ('platform_admin', 'tenant_admin', 'member')
    union all
    select 4, tt.name || ' · ' || ar.pack || '/' || ar.key || ' ⇐ ' || u.username
    from admin.app_roles ar join admin.group_members gm on gm.group_id = ar.group_id
    join admin.users u on u.id = gm.user_id join tt on tt.id = ar.tenant_id
    where gm.tenant_id <> ar.tenant_id or u.tenant_id <> ar.tenant_id
    union all
    select 5, tt.name || ' · ' || ar.pack || '/' || ar.key
    from admin.app_roles ar join tt on tt.id = ar.tenant_id and tt.active
    where not exists (select 1 from onapp where onapp.tenant_id = ar.tenant_id and onapp.app = ar.pack))
  select rule, count(*)::int as n, to_jsonb((array_agg(label order by label))[1:${SAMPLES}]) as sample
  from viol group by rule`;

export const appRolesCheck: OpsCheck = {
  key: "app_roles",
  async run(d) {
    const rows = await systemRead(d.db, (tx) => tx.execute<AppRolesRow>(appRolesQuery()));
    return evaluateAppRoles(rows.map((r) => ({ rule: r.rule, n: Number(r.n), sample: r.sample })));
  },
};
