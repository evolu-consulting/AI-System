// sohoptac2 · đổi URL ở `admin.app_catalog` từ localhost (tunnel) sang các host https thử nghiệm. Idempotent: CHỈ cập nhật hàng còn trỏ
// localhost/127.0.0.1 (hàng đã sửa tay hoặc đã đổi rồi giữ nguyên). Mặc định chỉ in kế hoạch; --apply mới ghi.
//   docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/s2-app-urls.ts --base-domain evoluconsulting.com [--apply]
// (cần ./build mới đã có file này, tức sau deploy.ps1; DATABASE_URL = owner do compose cấp). Không in bí mật.
import postgres from "postgres";

export type CatalogRow = { key: string; url: string };
export type UrlChange = { key: string; from: string; to: string };

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;
const BASE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/;

/** Host https theo khoá app (khớp edge/sohoptac2.conf). */
export function targetUrls(base: string): Record<string, string> {
  if (!BASE.test(base)) throw new Error(`base-domain không hợp lệ: ${base}`);
  return {
    chat: `https://ai2.${base}`,
    contracts: `https://sohoptac2.${base}`,
    studio: `https://ai2-hub.${base}/studio/`,
    admin: `https://ai2-admin.${base}`,
  };
}

/** Chỉ hàng có khoá đã biết VÀ url còn là localhost. */
export function planUrlChanges(base: string, rows: CatalogRow[]): UrlChange[] {
  const t = targetUrls(base);
  return rows.flatMap((r) =>
    t[r.key] !== undefined && LOCAL.test(r.url)
      ? [{ key: r.key, from: r.url, to: t[r.key] as string }]
      : [],
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const i = args.indexOf("--base-domain");
  const base = i >= 0 ? args[i + 1] : undefined;
  if (!base) throw new Error("cần --base-domain <domain>");
  const apply = args.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("thiếu DATABASE_URL");
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql<CatalogRow[]>`select key, url from admin.app_catalog`;
    const changes = planUrlChanges(base, rows);
    for (const c of changes)
      console.log(`${apply ? "đổi" : "sẽ đổi"} ${c.key}: ${c.from} -> ${c.to}`);
    if (changes.length === 0)
      console.log("s2-app-urls: không có hàng nào còn trỏ localhost — không đổi gì");
    if (!apply) return void console.log("s2-app-urls: chạy thử (thêm --apply để ghi)");
    // Điều kiện url còn localhost lặp lại trong UPDATE để an toàn khi chạy song song.
    const n = await sql`
      update admin.app_catalog a set url = v.url, version = a.version + 1, updated_at = now()
      from (select * from json_to_recordset(${JSON.stringify(changes.map((c) => ({ key: c.key, url: c.to })))}::json)
            as x(key text, url text)) v
      where a.key = v.key and a.url ~* '^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:[0-9]+)?(/|$)'`;
    console.log(`s2-app-urls: đã ghi ${n.count} hàng`);
  } finally {
    await sql.end();
  }
}

if (import.meta.main) await main();
