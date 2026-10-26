// CR-097 D1 · XEM TRƯỚC "N đối tác đổi mức" khi bật engine HD8 (U1/U2) — CHỈ ĐỌC (tx READ ONLY), chạy TRƯỚC khi bật trên server.
//   bun tools/scripts/src/d1-preview.ts --tenant nitigroup [--today YYYY-MM-DD] [--json]
// Điểm mới = đúng đường đọc của `/partners` (cùng `partnerData` + `partnersOf` + cấu hình đã lưu hoặc mặc định), cho MỌI đối tác
// (không lọc quyền thấy). Mức cũ = điểm V2-E đã chốt gần nhất (`score_locks.level`). Khác `POST /scoring/:role/preview` (so cấu hình
// nháp với cấu hình hiện tại, cùng engine HD8) — lệnh này so engine MỚI với mức khách đang thấy từ V2-E. Cần DATABASE_URL (chủ migration).
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { partnerData } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/partners-data.repo";
import {
  priceGaps,
  priceLines,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/goods-prices.rules";
import {
  DEFAULT_TENANT_TZ,
  localDate,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/local-time.rules";
import {
  factsOf,
  partnersOf,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/partners.rules";
import {
  defaultConfig,
  normalise,
  type Role,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/scoring-config.rules";
import { type OldLock, previewLevels, previewLines } from "./d1-preview.rules";

function argOf(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function previewTenant(url: string, key: string, today?: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [t] = await sql<{ id: string }[]>`select id from admin.tenants where key = ${key}`;
    if (!t) throw new Error(`d1-preview: không có tenant "${key}"`);
    const day = today ?? localDate(new Date(), DEFAULT_TENANT_TZ);
    const db = drizzle(sql);
    const rows = await db.transaction(
      async (tx) => {
        const data = await partnerData(tx, t.id, day);
        const facts = factsOf(data.facts, priceGaps(priceLines(data.contracts, day), data.quotes));
        const stored = new Map(data.configs.map((c) => [c.role, c]));
        const cfg = (role: Role) => {
          const s = stored.get(role);
          return s ? { ...s, criteria: normalise(s.criteria) } : defaultConfig(role);
        };
        const cfgs = { customer: cfg("customer"), supplier: cfg("supplier") };
        return partnersOf({
          facts,
          aggs: data.aggs,
          names: data.names,
          cfgs,
          today: day,
          role: null,
          visible: () => true,
        });
      },
      { accessMode: "read only" },
    );
    const locks = await sql<
      OldLock[]
    >`select party_key, role, grp, period::text as period, level, jobs
      from contracts.score_locks where tenant_id = ${t.id}`;
    return previewLevels(rows, locks);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const key = argOf(argv, "--tenant");
  if (!key) throw new Error("d1-preview: cần --tenant <khoá tenant>");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("d1-preview: cần DATABASE_URL (chủ migration)");
  const today = argOf(argv, "--today");
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today))
    throw new Error("d1-preview: --today YYYY-MM-DD");
  const p = await previewTenant(url, key, today);
  if (argv.includes("--json")) console.log(JSON.stringify(p, null, 2));
  else for (const l of previewLines(key, p)) console.log(l);
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  });
