// tool-seed-niti · luật thuần của `seed-niti.ts` (không I/O): chặn môi trường, định dạng file mật khẩu. Test: seed-niti.rules.test.ts.
import { isLocalDbHost } from "./seed-community-demo.guard";
import type { SeedSpec } from "./seed-niti.data";

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
