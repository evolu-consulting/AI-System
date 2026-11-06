// CR-121 c20 (D3) · ops-checks · "Hồ sơ công ty": tên công ty có MỘT nguồn = `admin.tenants.name` (pack-contracts 0076 gỡ bản trùng
// `contracts.company_settings.company_name`). Quy tắc (cả hai là lỗi):
//  1. Cột `contracts.company_settings.company_name` không được tồn tại (bản trùng quay lại ⇒ hai nguồn tên).
//  2. Mọi công ty có tên (không rỗng/chỉ khoảng trắng) — `/pack/me` đọc tên từ đây, tên rỗng làm brand mất tên.
// Một câu SQL tập hợp trên catalog + `admin.tenants` (hub_api đọc được); không đọc bảng gói (FORCE RLS), không lặp theo tenant (Luật 4c).
import { sql } from "drizzle-orm";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { systemRead } from "./check-kit";

export type TenantProfileRule = 1 | 2;
export type TenantProfileRow = { rule: TenantProfileRule; n: number; sample: string[] };

const SAMPLES = 5;

const RULES: Record<TenantProfileRule, { what: string; fix: string }> = {
  1: {
    what: "cột company_settings.company_name còn tồn tại (tên công ty bị lưu hai nơi)",
    fix: "Chạy lại migration pack-contracts 0076 (gỡ cột) — báo kỹ thuật.",
  },
  2: {
    what: "công ty có tên rỗng",
    fix: "Admin › Công ty › Hồ sơ: nhập tên công ty (brand `/pack/me` lấy tên từ đây).",
  },
};

/** Thuần. Có vi phạm ⇒ crit; sạch ⇒ ok. */
export function evaluateTenantProfile(rows: readonly TenantProfileRow[]): OpsCheckResult {
  const by = new Map(rows.filter((r) => r.n > 0).map((r) => [r.rule, r]));
  const value = { rule1: by.get(1)?.n ?? 0, rule2: by.get(2)?.n ?? 0 };
  if (by.size === 0)
    return {
      status: "ok",
      value,
      message: "Tên công ty một nguồn (admin.tenants.name), không lệch",
    };
  const parts = [...by.values()]
    .sort((a, b) => a.rule - b.rule)
    .map((r) => {
      const more = r.n > r.sample.length ? ` và ${r.n - r.sample.length} nữa` : "";
      const who = r.sample.length ? `: ${r.sample.slice(0, SAMPLES).join(", ")}${more}` : "";
      return `[${r.rule}] ${r.n} ${RULES[r.rule].what}${who}`;
    });
  return {
    status: "crit",
    value,
    message: parts.join(" · "),
    hint: [...by.keys()]
      .sort()
      .map((k) => RULES[k].fix)
      .join(" "),
  };
}

/** Một câu, văn bản cố định. Catalog (`pg_attribute`) không cần quyền trên schema gói. */
export const tenantProfileQuery = () => sql`
  with viol as (
    select 1 as rule, 'company_settings.company_name' as label
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'contracts' and c.relname = 'company_settings' and a.attname = 'company_name'
      and a.attnum > 0 and not a.attisdropped
    union all
    select 2, t.key from admin.tenants t where nullif(btrim(t.name), '') is null)
  select rule, count(*)::int as n, to_jsonb((array_agg(label order by label))[1:${SAMPLES}]) as sample
  from viol group by rule`;

export const tenantProfileCheck: OpsCheck = {
  key: "tenant_profile",
  async run(d) {
    const rows = await systemRead(d.db, (tx) => tx.execute<TenantProfileRow>(tenantProfileQuery()));
    return evaluateTenantProfile(
      rows.map((r) => ({ rule: r.rule, n: Number(r.n), sample: r.sample })),
    );
  },
};
