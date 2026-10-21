// ADM-FR-42 · usage-analytics · luật thuần của phân tích token (không biết DB/HTTP): tier model, xô thời gian (ngày/tuần/
// tháng, ngày VN), tách kết quả GROUPING SETS theo chiều, cộng tier, con trỏ phân trang bản ghi, KPI.
import type { UsageBreakdownRow, UsageGrain } from "@ai/contracts";

/** Tier của model theo tên (`claude-opus-5-5` → opus); model lạ → other; null → unknown. */
export function modelTier(model: string | null): string {
  if (model === null || model === "") return "unknown";
  const m = model.toLowerCase();
  for (const t of ["opus", "sonnet", "haiku"]) if (m.includes(t)) return t;
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3")) return "openai";
  return "other";
}

const DAY_MS = 86_400_000;
const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Đầu xô của ngày `d` (`YYYY-MM-DD`): ngày; tuần ISO (thứ Hai, như `date_trunc('week')`); ngày 1 của tháng. */
export function bucketOf(d: string, grain: UsageGrain): string {
  if (grain === "day") return d;
  if (grain === "month") return `${d.slice(0, 7)}-01`;
  const ms = dayMs(d);
  const dow = (new Date(ms).getUTCDay() + 6) % 7; // thứ Hai = 0
  return dayStr(ms - dow * DAY_MS);
}

/** Mọi đầu xô (tăng dần, không trùng) phủ [from, to] — trục x đủ điểm, xô rỗng = 0. */
export function bucketsOf(from: string, to: string, grain: UsageGrain): string[] {
  const out: string[] = [];
  for (let ms = dayMs(from); ms <= dayMs(to); ms += DAY_MS) {
    const b = bucketOf(dayStr(ms), grain);
    if (out[out.length - 1] !== b) out.push(b);
  }
  return out;
}

/** Ngày đầu của khoảng liền trước cùng số ngày. */
export function previousFrom(from: string, to: string): string {
  const n = Math.round((dayMs(to) - dayMs(from)) / DAY_MS) + 1;
  return dayStr(dayMs(from) - n * DAY_MS);
}

/** Thứ tự cột trong `grouping(...)` của câu breakdown (bit 1 = cột bị gộp, cột đầu = bit cao nhất). */
export const GROUP_COLS = ["app", "agent_id", "model", "feature", "tenant_id", "outcome"] as const;
export type GroupCol = (typeof GROUP_COLS)[number];
export type GroupSet = GroupCol | "tree";
const TREE: readonly GroupCol[] = ["app", "agent_id", "feature", "model"];

/** Mặt nạ `grouping(...)` của một tập cột được nhóm. */
export function maskOf(cols: readonly GroupCol[]): number {
  let m = 0;
  GROUP_COLS.forEach((c, i) => {
    if (!cols.includes(c)) m |= 1 << (GROUP_COLS.length - 1 - i);
  });
  return m;
}
const BY_MASK = new Map<number, GroupSet>([
  ...GROUP_COLS.map((c) => [maskOf([c]), c] as [number, GroupSet]),
  [maskOf(TREE), "tree"],
]);
/** Mặt nạ → tập (chiều đơn hoặc cây app→agent→feature→model); lạ → null. */
export const setOf = (mask: number): GroupSet | null => BY_MASK.get(mask) ?? null;

export type Measures = Omit<UsageBreakdownRow, "key" | "label">;
/** Hàng SQL (số lớn dạng chuỗi) → số đo; `cost` false ⇒ không có khoá cost_usd. */
export type MeasureRow = {
  input_tokens: string;
  output_tokens: string;
  cache_tokens: string;
  calls: string;
  runs: string;
  errors: string;
  cost_usd: string;
};
export function measuresOf(r: MeasureRow): Measures {
  const input = Number(r.input_tokens);
  const output = Number(r.output_tokens);
  return {
    input_tokens: input,
    output_tokens: output,
    cache_tokens: Number(r.cache_tokens),
    tokens: input + output,
    calls: Number(r.calls),
    runs: Number(r.runs),
    errors: Number(r.errors),
    cost_usd: normMoney(r.cost_usd),
  };
}

/** numeric → chuỗi tiền ≤ 6 số lẻ, không âm (âm do làm tròn trừ dần ⇒ 0). */
export function normMoney(v: string | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  return String(Math.round(n * 1e6) / 1e6);
}

/** Cộng hai bộ số đo (tiền cộng theo micro-USD để không lệch float). */
export function addMeasures(a: Measures, b: Measures): Measures {
  const micro = (s: string | undefined) => Math.round(Number(s ?? 0) * 1e6);
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_tokens: a.cache_tokens + b.cache_tokens,
    tokens: a.tokens + b.tokens,
    calls: a.calls + b.calls,
    runs: a.runs + b.runs,
    errors: a.errors + b.errors,
    cost_usd: String((micro(a.cost_usd) + micro(b.cost_usd)) / 1e6),
  };
}

export const ZERO_MEASURES: Measures = {
  input_tokens: 0,
  output_tokens: 0,
  cache_tokens: 0,
  tokens: 0,
  calls: 0,
  runs: 0,
  errors: 0,
  cost_usd: "0",
};

/** Gộp breakdown theo model thành theo tier (giảm dần theo token). */
export function tiersOf(byModel: readonly UsageBreakdownRow[]): UsageBreakdownRow[] {
  const acc = new Map<string, Measures>();
  for (const r of byModel) {
    const t = modelTier(r.key);
    acc.set(t, addMeasures(acc.get(t) ?? ZERO_MEASURES, r));
  }
  return sortTop(
    [...acc].map(([key, m]) => ({ key, label: key, ...m })),
    Infinity,
  );
}

/** Giảm dần theo token rồi số lời gọi, khoá null cuối; cắt `n`. */
export function sortTop<T extends { key: string | null; tokens: number; calls: number }>(
  rows: readonly T[],
  n: number,
): T[] {
  return [...rows]
    .sort(
      (a, b) =>
        b.tokens - a.tokens ||
        b.calls - a.calls ||
        (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0) ||
        String(a.key).localeCompare(String(b.key)),
    )
    .slice(0, n);
}

/** Tỉ lệ lỗi (0–1) — 0 lời gọi ⇒ 0. */
export const errorRate = (m: Pick<Measures, "errors" | "calls">): number =>
  m.calls === 0 ? 0 : m.errors / m.calls;

/** Con trỏ bản ghi = `at|id` (base64url). */
export function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, "utf8").toString("base64url");
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Con trỏ hỏng ⇒ "invalid" (400 ở service). */
export function decodeCursor(c: string): { at: string; id: string } | "invalid" {
  const s = Buffer.from(c, "base64url").toString("utf8");
  const [at, id, extra] = s.split("|");
  if (extra !== undefined || !at || !id || !UUID_RE.test(id) || Number.isNaN(Date.parse(at)))
    return "invalid";
  return { at, id };
}

/** Cột CSV bản ghi theo role (tenant_admin không có `cost_usd`, M4-R08). */
export function recordColumns(platform: boolean): readonly string[] {
  const base = [
    "at",
    "tenant_key",
    "username",
    "app",
    "feature",
    "agent_key",
    "run_id",
    "provider_key",
    "model",
    "billing",
    "outcome",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "latency_ms",
  ];
  return platform ? [...base, "cost_usd"] : base;
}
