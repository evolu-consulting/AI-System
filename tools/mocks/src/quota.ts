// ADM-FR-42 · spec M4 plan §7: `bun run mock:quota` — vai Hub ghi hub.usage_logs (owner) + NOTIFY quota_threshold.
import postgres from "postgres";

export type QuotaArgs = {
  tenant: string;
  runs: number;
  quota: number | null;
  feature: string | null;
  seed: boolean;
};

export type UsageRow = {
  feature: string | null;
  at: Date;
  billable: number | null;
  cost: number;
  overage: boolean;
};

const STR_FLAGS = { "--tenant": "tenant", "--feature": "feature" } as const;
const INT_FLAGS = { "--runs": "runs", "--quota": "quota" } as const;

function readValue(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) throw new Error(`mock:quota: ${flag} cần giá trị`);
  return v;
}

export function parseArgs(argv: string[]): QuotaArgs {
  const out: QuotaArgs = { tenant: "", runs: 0, quota: null, feature: null, seed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--seed") out.seed = true;
    else if (a in STR_FLAGS) out[STR_FLAGS[a as keyof typeof STR_FLAGS]] = readValue(argv, i++, a);
    else if (a in INT_FLAGS) {
      const n = Number(readValue(argv, i++, a));
      if (!Number.isInteger(n) || n < 1) throw new Error(`mock:quota: ${a} phải là số nguyên >= 1`);
      out[INT_FLAGS[a as keyof typeof INT_FLAGS]] = n;
    } else throw new Error(`mock:quota: tham số lạ ${a}`);
  }
  return validate(out);
}

function validate(out: QuotaArgs): QuotaArgs {
  if (!out.tenant) throw new Error("mock:quota: thiếu --tenant <key>");
  if (!out.runs && !out.seed) throw new Error("mock:quota: cần --runs N và/hoặc --seed");
  return out;
}

/** N run (mỗi run 1 hàng); hàng thứ > quota mang overage=true (R07). */
export function runRows(a: QuotaArgs, now: Date): UsageRow[] {
  return Array.from({ length: a.runs }, (_, i) => ({
    feature: a.feature,
    at: now,
    billable: 0.1,
    cost: 0.06,
    overage: a.quota !== null && i + 1 > a.quota,
  }));
}

export const SEED_FEATURES = ["dich", "tom-tat", "viet-lai"] as const;

/** 60 ngày × 3 feature + 1 hàng feature null + 1 hàng billable null. */
export function seedRows(now: Date): UsageRow[] {
  const rows: UsageRow[] = [];
  for (let d = 0; d < 60; d++) {
    const at = new Date(now.getTime() - d * 86_400_000);
    SEED_FEATURES.forEach((feature, k) => {
      for (let n = 0; n <= (d + k) % 3; n++) {
        rows.push({ feature, at, billable: 0.1 * (k + 1), cost: 0.06 * (k + 1), overage: false });
      }
    });
  }
  rows.push({ feature: null, at: now, billable: 0.1, cost: 0.06, overage: false });
  rows.push({ feature: SEED_FEATURES[0], at: now, billable: null, cost: 0.06, overage: false });
  return rows;
}

type Sql = ReturnType<typeof postgres>;

async function ensureFeature(sql: Sql, key: string): Promise<string> {
  await sql`insert into admin.features (id, key, name, status)
    values (${Bun.randomUUIDv7()}, ${key}, ${sql.json({ vi: key, en: key })}, 'on')
    on conflict (key) do nothing`;
  const [f] = await sql<{ id: string }[]>`select id from admin.features where key = ${key}`;
  if (!f) throw new Error(`mock:quota: không tạo được feature ${key}`);
  return f.id;
}

async function setQuota(sql: Sql, tenantId: string, featureId: string | null, max: number) {
  await sql`insert into admin.tenant_quotas (tenant_id, feature_id, max_runs)
    values (${tenantId}, ${featureId}, ${max})
    on conflict (tenant_id, feature_id) do update set max_runs = excluded.max_runs, updated_at = now()`;
}

async function insertRows(
  sql: Sql,
  tenantId: string,
  ids: Map<string | null, string | null>,
  rows: UsageRow[],
) {
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK).map((r) => ({
      tenant_id: tenantId,
      run_id: Bun.randomUUIDv7(),
      feature_id: ids.get(r.feature) ?? null,
      billing: "api",
      model: "mock-model",
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: r.cost,
      billable_usd: r.billable,
      overage: r.overage,
      at: r.at,
    }));
    await sql`insert into hub.usage_logs ${sql(part)}`;
  }
}

export async function main(argv: string[], url: string): Promise<void> {
  const a = parseArgs(argv);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [t] = await sql<{ id: string }[]>`select id from admin.tenants where key = ${a.tenant}`;
    if (!t) throw new Error(`mock:quota: không có tenant "${a.tenant}"`);
    const now = new Date();
    const keys = [...(a.feature ? [a.feature] : []), ...(a.seed ? SEED_FEATURES : [])];
    const ids = new Map<string | null, string | null>([[null, null]]);
    for (const k of new Set(keys)) ids.set(k, await ensureFeature(sql, k));
    if (a.quota !== null)
      await setQuota(sql, t.id, a.feature ? (ids.get(a.feature) ?? null) : null, a.quota);
    const rows = [...(a.runs ? runRows(a, now) : []), ...(a.seed ? seedRows(now) : [])];
    await insertRows(sql, t.id, ids, rows);
    await sql`select pg_notify('quota_threshold', ${JSON.stringify({ tenant_id: t.id })})`;
    console.log(`mock:quota: ${rows.length} hàng usage_logs cho ${a.tenant}`);
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("mock:quota: thiếu DATABASE_URL");
  await main(process.argv.slice(2), url);
}
