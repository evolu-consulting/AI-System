// ADM-FR-40, ADM-FR-41 · M4-R01–R06 · hàm thuần quota (plan-rules §A4, plan §5.1). Không I/O.
// Tiền so bằng số nguyên micro-USD (`BigInt`), không `parseFloat`.
import type { QuotaItemInput, Role } from "@ai/contracts";

export const QUOTA_TZ_OFFSET_MIN = 420; // Asia/Ho_Chi_Minh, không DST (M4-R01)
export type Level = "none" | "warn" | "over";
export type QuotaLimitsN = {
  maxRuns: number | null;
  maxTokens: number | null;
  maxUsd: string | null;
};
export type UsageN = { runs: number; tokens: number; billableUsd: string; unpricedRows: number };
export type QuotaRow = QuotaLimitsN & { featureId: string | null };
export type QuotaEval = {
  featureId: string | null;
  pct: number | null;
  level: Level;
  used: UsageN;
};
export type AlertKey = { featureId: string | null; level: 80 | 100 };

const OFFSET_MS = QUOTA_TZ_OFFSET_MIN * 60_000;
const MONEY_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/** `[01 00:00 VN, 01 tháng sau 00:00 VN)` ra UTC; `month` = "YYYY-MM" theo giờ VN. */
export function monthRange(now: Date): { month: string; from: Date; to: Date } {
  const vn = new Date(now.getTime() + OFFSET_MS);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1) - OFFSET_MS);
  const to = new Date(Date.UTC(y, m + 1, 1) - OFFSET_MS);
  return { month: `${y}-${String(m + 1).padStart(2, "0")}`, from, to };
}

/** Chuỗi thập phân → micro-USD (cắt sau 6 số lẻ). Chuỗi hỏng → ném (lỗi lập trình/dữ liệu). */
export function toMicro(v: string): bigint {
  const m = MONEY_RE.exec(v.trim());
  if (!m) throw new Error(`toMicro: số tiền không hợp lệ ${v}`);
  const frac = (m[3] ?? "").padEnd(6, "0").slice(0, 6);
  const abs = BigInt(m[2] ?? "0") * 1_000_000n + BigInt(frac);
  return m[1] === "-" ? -abs : abs;
}

const pctOf = (used: bigint, max: bigint): number => Number((used * 100n) / max);

/** Max các chiều có giới hạn, `floor(used*100/max)`; không chiều nào → null. */
export function quotaPct(l: QuotaLimitsN, u: UsageN): number | null {
  const ps: number[] = [];
  if (l.maxRuns !== null) ps.push(pctOf(BigInt(u.runs), BigInt(l.maxRuns)));
  if (l.maxTokens !== null) ps.push(pctOf(BigInt(u.tokens), BigInt(l.maxTokens)));
  if (l.maxUsd !== null) ps.push(pctOf(toMicro(u.billableUsd), toMicro(l.maxUsd)));
  return ps.length === 0 ? null : Math.max(...ps);
}

/** null/<80 none · 80–99 warn · ≥100 over. */
export function quotaLevel(pct: number | null): Level {
  if (pct === null || pct < 80) return "none";
  return pct >= 100 ? "over" : "warn";
}

export const ZERO_USAGE: UsageN = { runs: 0, tokens: 0, billableUsd: "0", unpricedRows: 0 };

/** Quota feature dùng `byFeature` (thiếu = 0), quota null dùng `total`; giữ thứ tự đầu vào. */
export function evaluateQuota(i: {
  quotas: readonly QuotaRow[];
  total: UsageN;
  byFeature: ReadonlyMap<string, UsageN>;
}): QuotaEval[] {
  return i.quotas.map((q) => {
    const used =
      q.featureId === null ? i.total : (i.byFeature.get(q.featureId) ?? { ...ZERO_USAGE });
    const pct = quotaPct(q, used);
    return { featureId: q.featureId, pct, level: quotaLevel(pct), used };
  });
}

const alertId = (k: { featureId: string | null; level: number }) =>
  `${k.featureId ?? ""}:${k.level}`;

/** warn → 80 pending; over → 100 pending + 80 skipped nếu chưa có; đã có trong `existing` → bỏ. */
export function alertsDue(
  evals: readonly QuotaEval[],
  existing: readonly AlertKey[],
): (AlertKey & { pct: number; status: "pending" | "skipped" })[] {
  const have = new Set(existing.map(alertId));
  const out: (AlertKey & { pct: number; status: "pending" | "skipped" })[] = [];
  for (const e of evals) {
    if (e.level === "none" || e.pct === null) continue;
    const add = (level: 80 | 100, status: "pending" | "skipped") => {
      const k = { featureId: e.featureId, level };
      if (!have.has(alertId(k))) out.push({ ...k, pct: e.pct as number, status });
    };
    if (e.level === "warn") add(80, "pending");
    else {
      add(100, "pending");
      add(80, "skipped");
    }
  }
  return out;
}

/** Chỉ tenant_admin; eval có pct lớn nhất với level ≠ none; bằng nhau → featureId null trước. */
export function bannerFor(
  role: Role,
  evals: readonly QuotaEval[],
): { level: "warn" | "over"; pct: number; featureId: string | null } | null {
  if (role !== "tenant_admin") return null;
  let best: QuotaEval | null = null;
  for (const e of evals) {
    if (e.level === "none" || e.pct === null) continue;
    const better =
      best === null ||
      e.pct > (best.pct as number) ||
      (e.pct === best.pct && e.featureId === null && best.featureId !== null);
    if (better) best = e;
  }
  if (!best) return null;
  return {
    level: best.level as "warn" | "over",
    pct: best.pct as number,
    featureId: best.featureId,
  };
}

/** "300" / "300.5" → "300.00" / "300.50" (dạng numeric(12,2) DB trả về) để so bộ cũ/mới. */
export function canonicalUsd(v: string | null): string | null {
  if (v === null) return null;
  const micro = toMicro(v);
  const cents = micro / 10_000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

/** Bỏ dòng mọi giới hạn null; `max_usd` về dạng 2 số lẻ. Giữ thứ tự. */
export function normalizeQuotaItems(items: readonly QuotaItemInput[]): QuotaItemInput[] {
  return items
    .filter((x) => x.max_runs !== null || x.max_tokens !== null || x.max_usd !== null)
    .map((x) => ({ ...x, max_usd: canonicalUsd(x.max_usd) }));
}

/** Index dòng đầu tiên trùng `feature_id` với một dòng trước (null coi là một giá trị); không trùng → null. */
export function duplicateFeatureIndex(items: readonly QuotaItemInput[]): number | null {
  const seen = new Set<string>();
  for (const [i, x] of items.entries()) {
    const k = x.feature_id ?? "";
    if (seen.has(k)) return i;
    seen.add(k);
  }
  return null;
}

/** Hai bộ (đã normalize) bằng nhau không kể thứ tự dòng. */
export function sameQuotaSet(a: readonly QuotaItemInput[], b: readonly QuotaItemInput[]): boolean {
  const key = (xs: readonly QuotaItemInput[]) =>
    xs
      .map((x) => JSON.stringify([x.feature_id ?? "", x.max_runs, x.max_tokens, x.max_usd]))
      .sort()
      .join("|");
  return a.length === b.length && key(a) === key(b);
}

/** Tiêu đề + nội dung mail cảnh báo (M4-R05); không chứa email người nhận. */
export function alertMail(i: {
  tenantName: string;
  pct: number;
  locale: "vi" | "en";
  link: string;
}): { subject: string; text: string } {
  if (i.locale === "en") {
    return {
      subject: `[${i.tenantName}] ${i.pct}% of monthly quota used`,
      text: `${i.tenantName} has used ${i.pct}% of its monthly quota.\nDetails: ${i.link}\n`,
    };
  }
  return {
    subject: `[${i.tenantName}] Đã dùng ${i.pct}% quota tháng`,
    text: `${i.tenantName} đã dùng ${i.pct}% quota tháng.\nXem chi tiết: ${i.link}\n`,
  };
}
