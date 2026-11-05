// sohoptac2 · đổi URL ở `admin.app_catalog` từ localhost (tunnel) sang các host https thử nghiệm. Idempotent: CHỈ cập nhật hàng còn trỏ
// localhost/127.0.0.1 (hàng đã sửa tay hoặc đã đổi rồi giữ nguyên). Mặc định chỉ in kế hoạch; --apply mới ghi.
//   docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/s2-app-urls.ts --base-domain evoluconsulting.com [--apply]
// (cần ./build mới đã có file này, tức sau deploy.ps1; DATABASE_URL = owner do compose cấp). Không in bí mật.
// CR-118: Community nằm trong web gộp ⇒ hàng `community` = `<host Sổ Hợp Tác>/community` và `sso=false` (không còn hand-off SSO). Hàng còn host
// cũ `community[-test].<d>` cũng được đổi. Staging/UAT (không domain): `--community-url http://127.0.0.1:28531/community --apply` chỉ chỉnh hàng community.
// CR-119 (quyết định 2026-11-05): web gộp CHỈ ở pp[-test].<d> — contracts → https://app[-test].<d>, community → https://app[-test].<d>/community;
// hàng còn host sohoptac[-test].<d> cũng được đổi (idempotent). Chạy SAU khi DNS + cert của app.<d> sẵn sàng.
import postgres from "postgres";

export type CatalogRow = { key: string; url: string; sso?: boolean };
export type UrlChange = { key: string; from: string; to: string };

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;
const TESTHOST =
  /^https:\/\/(ai-test|ai-test-admin|ai-test-hub|community-test)\.[a-z0-9.-]+(\/|$)/i;
/** Host Community trước CR-118 (host riêng, SPA riêng) — nay chỉ còn 301 về `/community` của host chính. */
const LEGACY_COMMUNITY = /^https:\/\/community(-test)?\.[a-z0-9.-]+(\/|$)/i;
/** CR-119: host chính cũ `sohoptac[-test].<d>` — thay bằng `app[-test].<d>`. */
const SOHOPTAC_HOST = /^https:\/\/sohoptac(-test)?\.[a-z0-9.-]+(\/|$)/i;
const BASE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/;
export type Hosts = "test" | "prod";

/** Host https theo khoá app (khớp edge/sohoptac2.conf). CR-119: web gộp ở app[-test].<d>; SHT ở gốc, Community ở /community. */
export function targetUrls(base: string, hosts: Hosts = "test"): Record<string, string> {
  if (!BASE.test(base)) throw new Error(`base-domain không hợp lệ: ${base}`);
  const sfx = hosts === "prod" ? "" : "-test";
  const app = `https://app${sfx}.${base}`;
  return {
    chat: `https://ai${sfx}.${base}`,
    contracts: app,
    studio: `https://ai${sfx}-hub.${base}/studio/`,
    admin: `https://ai${sfx}-admin.${base}`,
    community: `${app}/community`, // community.<d> chi con 301 (edge-lib.sh)
  };
}

/** Chỉ hàng có khoá đã biết VÀ url còn là localhost (hosts=prod: hoặc còn là host -test). Hàng khác giữ nguyên. */
export function planUrlChanges(
  base: string,
  rows: CatalogRow[],
  hosts: Hosts = "test",
): UrlChange[] {
  const t = targetUrls(base, hosts);
  const old = (r: CatalogRow) =>
    LOCAL.test(r.url) ||
    (r.key === "community" && LEGACY_COMMUNITY.test(r.url)) ||
    (hosts === "prod" && TESTHOST.test(r.url)) ||
    ((r.key === "contracts" || r.key === "community") && SOHOPTAC_HOST.test(r.url));
  return rows.flatMap((r) =>
    t[r.key] !== undefined && old(r) && r.url !== t[r.key]
      ? [{ key: r.key, from: r.url, to: t[r.key] as string }]
      : [],
  );
}

/** CR-118: `--community-url` (staging/UAT, không domain): đặt đúng URL cho hàng `community` nếu khác. */
export function planCommunityUrl(rows: CatalogRow[], url: string): UrlChange[] {
  if (!/^https?:\/\/[^\s]+\/community$/.test(url))
    throw new Error("--community-url phải có dạng http(s)://<host>[:cổng]/community");
  return rows.flatMap((r) =>
    r.key === "community" && r.url !== url ? [{ key: r.key, from: r.url, to: url }] : [],
  );
}

/** CR-118: Community trong web gộp ⇒ không còn hand-off SSO; trả khoá còn `sso=true` cần tắt (chỉ `community`). */
export function planCommunitySso(rows: CatalogRow[]): string[] {
  return rows.filter((r) => r.key === "community" && r.sso !== false).map((r) => r.key);
}

function flag(args: string[], k: string): string | undefined {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
}

type Opts = { base?: string; cmUrl?: string; hosts: Hosts; apply: boolean };

function parseArgs(args: string[]): Opts {
  const base = flag(args, "--base-domain");
  const cmUrl = flag(args, "--community-url");
  if (!base && !cmUrl) throw new Error("cần --base-domain <domain> hoặc --community-url <url>");
  const hosts = flag(args, "--hosts") ?? "test";
  if (hosts !== "test" && hosts !== "prod") throw new Error("--hosts phải là prod|test");
  return { base, cmUrl, hosts, apply: args.includes("--apply") };
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("thiếu DATABASE_URL");
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql<CatalogRow[]>`select key, url, sso from admin.app_catalog`;
    const changes = o.cmUrl
      ? planCommunityUrl(rows, o.cmUrl)
      : planUrlChanges(o.base as string, rows, o.hosts);
    const ssoOff = planCommunitySso(rows);
    const verb = o.apply ? "đổi" : "sẽ đổi";
    for (const c of changes) console.log(`${verb} ${c.key}: ${c.from} -> ${c.to}`);
    for (const k of ssoOff) console.log(`${verb} ${k}: sso true -> false`);
    if (changes.length === 0 && ssoOff.length === 0)
      console.log("s2-app-urls: không có hàng nào cần đổi — không đổi gì");
    if (!o.apply) return void console.log("s2-app-urls: chạy thử (thêm --apply để ghi)");
    // Điều kiện "còn giá trị cũ" lặp lại trong UPDATE để an toàn khi chạy song song.
    const n = await sql`
      update admin.app_catalog a set url = v.url, version = a.version + 1, updated_at = now()
      from (select * from json_to_recordset((${JSON.stringify(changes.map((c) => ({ key: c.key, url: c.to })))}::text)::json)
            as x(key text, url text)) v
      where a.key = v.key and a.url <> v.url and (${o.cmUrl !== undefined}
        or a.url ~* '^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:[0-9]+)?(/|$)'
        or (a.key = 'community' and a.url ~* '^https://community(-test)?\\.')
        or (${o.hosts === "prod"} and a.url ~* '^https://(ai-test|ai-test-admin|ai-test-hub|community-test)\\.')
        or (a.key in ('contracts', 'community') and a.url ~* '^https://sohoptac(-test)?\\.'))`;
    const s = await sql`
      update admin.app_catalog set sso = false, version = version + 1, updated_at = now()
      where key = 'community' and sso`;
    console.log(`s2-app-urls: đã ghi ${n.count} hàng url, ${s.count} hàng sso`);
  } finally {
    await sql.end();
  }
}

if (import.meta.main) await main();
