// pack-boundary · `bun run check:pack-sql`: migration của gói chỉ tham chiếu schema của chính gói
// (+ hàm nền tảng `packs.install`/`packs.secure_table`, `pg_catalog`). Quy tắc: docs/platform/pack-boundary.md.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/git";

/** Schema của nền tảng/gói khác mà migration gói không được tham chiếu trực tiếp. */
export const FOREIGN_SCHEMAS = [
  "admin",
  "hub",
  "ops",
  "public",
  "auth",
  "knowledge",
  "pkdemo",
  "contracts",
  "community",
  "dlc",
];
/**
 * Hàm gói↔gói được phép gọi (ADR-0043: cổng đọc cho RLS, SECURITY DEFINER, tenant từ GUC). Mỗi mục `schema.hàm`; thêm mục = ADR/CR.
 * Chỉ HÀM — bảng/view của gói khác vẫn cấm.
 */
export const ALLOWED_CROSS_PACK_FNS = [
  "contracts.community_partners",
  "contracts.community_link_partner",
];
/** Hàm nền tảng được phép gọi (`packs.<tên>`). */
export const ALLOWED_PLATFORM_FNS = [
  "install",
  "secure_table",
  "viewer_ext_org",
  "viewer_is_admin",
];
/** Nợ có chủ đích (TECH-DEBT #255): `<file>:<schema>` đã biết. */
export const KNOWN_DEBT = new Set([
  "0009_m1_visibility.sql:admin",
  "0010_m1b_visibility.sql:admin",
  "0011_m3_approvals.sql:hub",
  "0015_hd8_partners.sql:admin",
  "0021_assistant_agent.sql:packs",
  "0022_v2a_milestones.sql:admin",
  // TECH-DEBT #264: migration gói đã áp dụng trước CR-124/125, không sửa được.
  "contracts/0039_one_assistant.sql:packs",
  "contracts/0070_reviewer_visible.sql:hub",
  "contracts/0070_reviewer_visible.sql:admin",
  "contracts/0072_brand_bumps_config.sql:admin",
  "contracts/0073_brand_bumps_profile.sql:admin",
  "contracts/0076_company_name_one_source.sql:admin",
  "contracts/0077_emit_flow_event_grant.sql:hub",
  // CR-130 L2: cổng ghi liên kết đối tác kiểm `p_org` thuộc tenant bằng `admin.external_orgs` (hàm DEFINER; contracts không có bảng tài khoản ngoài).
  "contracts/0105_cr130_link_partner_explicit_key.sql:admin",
  "community/0010_emit_flow_event_grant.sql:hub",
  "knowledge/0006_scope_grants.sql:packs",
  // TECH-DEBT #264 (CR-124 q3/q4, đã áp dụng prod): gói gọi hàm hub.partner_* — chuyển sang cổng packs.* khi làm lại hộp thư đối tác.
  "contracts/0085_partner_send.sql:hub",
  "contracts/0087_partner_settings.sql:hub",
]);

export type Finding = { line: number; ref: string; msg: string };

/** Bỏ comment `--` và nội dung chuỗi '…' (giữ số dòng). */
export function stripSql(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/'(?:[^']|'')*'/g, "''").replace(/--.*$/, ""))
    .join("\n");
}

const QUALIFIED = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;
const CREATE_SCHEMA = /create\s+schema\s+(?:if\s+not\s+exists\s+)?"?([a-z_]+)/i;

function lineFindings(schema: string, text: string, line: number): Finding[] {
  const out: Finding[] = [];
  const foreign = FOREIGN_SCHEMAS.filter((s) => s !== schema);
  for (const m of text.matchAll(QUALIFIED)) {
    const q = (m[1] ?? "").toLowerCase();
    const ref = `${q}.${(m[2] ?? "").toLowerCase()}`;
    if (q === "packs" && !ALLOWED_PLATFORM_FNS.includes((m[2] ?? "").toLowerCase())) {
      out.push({ line, ref, msg: "hàm nền tảng ngoài danh sách cho phép" });
    } else if (foreign.includes(q) && !ALLOWED_CROSS_PACK_FNS.includes(ref)) {
      out.push({ line, ref, msg: `schema ngoài gói (${q})` });
    }
  }
  const s = CREATE_SCHEMA.exec(text)?.[1];
  if (s && s !== schema) out.push({ line, ref: s, msg: "tạo schema khác của gói" });
  return out;
}

export function checkPackSql(schema: string, sql: string): Finding[] {
  return stripSql(sql)
    .split("\n")
    .flatMap((text, i) => lineFindings(schema, text, i + 1));
}
function isKnownDebt(schema: string, file: string, q: string | undefined): boolean {
  return (
    (schema === "contracts" && KNOWN_DEBT.has(`${file}:${q}`)) ||
    KNOWN_DEBT.has(`${schema}/${file}:${q}`)
  );
}

function main(): number {
  const root = repoRoot();
  const dbDir = join(root, "packages/db");
  let bad = 0;
  for (const d of readdirSync(dbDir).filter((n) => n.startsWith("migrations-pack-"))) {
    const schema = d.slice("migrations-pack-".length);
    for (const f of readdirSync(join(dbDir, d)).filter((n) => n.endsWith(".sql"))) {
      const sql = readFileSync(join(dbDir, d, f), "utf8");
      for (const x of checkPackSql(schema, sql)) {
        const q = x.ref.split(".")[0];
        if (isKnownDebt(schema, f, q)) continue;
        bad++;
        console.error(`pack-sql: ${d}/${f}:${x.line} ${x.ref} — ${x.msg}`);
      }
    }
  }
  console.log(bad === 0 ? "pack-sql: sạch" : `pack-sql: ${bad} vi phạm`);
  return bad === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
