// tool-seed-niti · luật thuần của `seed-niti.ts` (không I/O): thân quy trình theo MÃ phòng, điều kiện luật chọn quy trình, so sánh
// idempotent, chặn môi trường, định dạng file mật khẩu. Test: seed-niti.rules.test.ts.
import type { RoutingCondition } from "@ai/contracts/hub-admin";
import { isLocalDbHost } from "./seed-community-demo.guard";
import type { Proc, RuleSpec, SeedSpec } from "./seed-niti.data";

/** Bước duyệt = phòng ban, cổng trưởng phòng (head_only). Không đặt nhóm chuyển cấp ⇒ mặc định về Toàn quyền khi quá hạn. */
export function slotBodyOf(p: Proc): { steps: Record<string, unknown>[] } {
  return {
    steps: p.steps.map((s) => ({
      kind: "review",
      key: s.key,
      name: s.name,
      department_group_id: null,
      department_group_key: s.dept,
      head_only: true,
      due_h: 24,
      remind_every_h: null,
      escalate_group_id: null,
      escalate_group_key: null,
      exclude_starter: false,
      when: null,
    })),
  };
}

/**
 * Điều kiện của một luật. Chỗ DUY NHẤT biết hình `{departmentIds, contractKinds}` (cr118-route-kind): đổi hình ⇒ sửa đúng hàm này.
 * `deptId` = id Group phòng ban của tenant.
 */
export function conditionOf(r: RuleSpec, deptId: string): RoutingCondition {
  return { departmentIds: [deptId], contractKinds: [r.kind] };
}

/** So JSON bỏ thứ tự khoá (so thân quy trình / điều kiện luật). */
export function canon(x: unknown): string {
  const walk = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(walk)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([k, val]) => [k, walk(val)]),
          )
        : v;
  return JSON.stringify(walk(x));
}

export type RuleLike = { condition: unknown; def_id: string; is_default: boolean };
/** Danh sách luật hiện có đã đúng như mong muốn (thứ tự, điều kiện, quy trình, không mặc định)? */
export function sameRules(cur: readonly RuleLike[], want: readonly RuleLike[]): boolean {
  return (
    cur.length === want.length &&
    cur.every(
      (c, i) =>
        want[i] !== undefined &&
        c.def_id === want[i].def_id &&
        c.is_default === want[i].is_default &&
        canon(c.condition) === canon(want[i].condition),
    )
  );
}

/** Tenant đã có theo khoá/tên: chỉ chấp nhận KHÔNG có, hoặc trùng cả khoá lẫn tên. Còn lại ⇒ lý do từ chối. */
export function tenantShape(
  spec: Pick<SeedSpec, "tenantKey" | "tenantName">,
  rows: readonly { key: string; name: string }[],
): "absent" | "present" | string {
  if (rows.length === 0) return "absent";
  const ok =
    rows.length === 1 && rows[0]?.key === spec.tenantKey && rows[0]?.name === spec.tenantName;
  return ok
    ? "present"
    : `tenant đã có nhưng khác hình dạng mong đợi (${rows.map((r) => `${r.key}="${r.name}"`).join("; ")}) — không ghi gì`;
}

/** Chặn ghi nhầm môi trường: `--apply` ngoài localhost/test (vd prod host `pg`) cần `--i-know-prod`. Dry-run luôn được. */
export function applyGuard(o: {
  apply: boolean;
  iKnowProd: boolean;
  appEnv: string | undefined;
  urls: readonly string[];
}): string | null {
  if (!o.apply || o.iKnowProd) return null;
  if (o.appEnv === "production") return "APP_ENV=production — thêm --i-know-prod nếu thật sự chủ ý";
  return o.urls.some((u) => !isLocalDbHost(u))
    ? "DB host ngoài localhost/test — thêm --i-know-prod nếu thật sự chủ ý"
    : null;
}

/** Một dòng file mật khẩu: `<tenant>\t<username>\t<mật khẩu>`. */
export const credLine = (tenant: string, username: string, pw: string): string =>
  `${tenant}\t${username}\t${pw}\n`;

/** Email theo quy ước demo (`<username>@<miền>`). */
export const emailOf = (username: string, domain: string): string => `${username}@${domain}`;
