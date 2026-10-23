// price-scout · luật thuần của "Cấu hình dò giá" (không React): form chuỗi ⇄ cấu hình, danh sách phân tách bằng dấu phẩy/xuống dòng,
// phần ghi đè so với mặc định nhóm, nhãn lượt dò đã dùng. Dùng chung tab NCC & giá của SP và mục Cài đặt › Dò giá thị trường.
import type { PriceScoutConfig, PriceScoutOverride, PriceScoutUsage } from "@ai/contracts";

export const LIST_MAX = 10;
export const LIST_KEYS = [
  "keywords",
  "include_sites",
  "exclude_sites",
  "watched_suppliers",
] as const;
export const CONFIG_KEYS = [
  "enabled",
  "keywords",
  "spec",
  "unit",
  "include_sites",
  "exclude_sites",
  "watched_suppliers",
  "region",
  "vat",
  "schedule",
  "alert_pct",
  "alert_watched",
  "instructions",
] as const satisfies readonly (keyof PriceScoutConfig)[];

/** Form dạng chuỗi: danh sách = một chuỗi phân tách bằng dấu phẩy/xuống dòng, trống = null. */
export type ScoutForm = {
  enabled: boolean;
  keywords: string;
  spec: string;
  unit: string;
  include_sites: string;
  exclude_sites: string;
  watched_suppliers: string;
  region: string;
  vat: PriceScoutConfig["vat"];
  schedule: PriceScoutConfig["schedule"];
  alert_pct: string;
  alert_watched: boolean;
  /** Yêu cầu dò giá tự do (màn SP). */
  instructions: string;
};

/** "a, b\nc" → ["a","b","c"] (bỏ trống, bỏ trùng không phân biệt hoa/thường). */
export function parseList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n;]/)) {
    const v = raw.trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

export const listText = (l: readonly string[]): string => l.join(", ");

export function toForm(c: PriceScoutConfig): ScoutForm {
  return {
    enabled: c.enabled,
    keywords: listText(c.keywords),
    spec: c.spec ?? "",
    unit: c.unit ?? "",
    include_sites: listText(c.include_sites),
    exclude_sites: listText(c.exclude_sites),
    watched_suppliers: listText(c.watched_suppliers),
    region: c.region ?? "",
    vat: c.vat,
    schedule: c.schedule,
    alert_pct: c.alert_pct == null ? "" : String(c.alert_pct),
    alert_watched: c.alert_watched,
    instructions: c.instructions ?? "",
  };
}

/** Câu đọc được dựng từ các ô cấu trúc cũ — điền sẵn ô "Yêu cầu dò giá" khi SP chưa có `instructions`. Không có gì ⇒ "". */
export function legacyInstructions(c: PriceScoutConfig): string {
  const parts: string[] = [];
  if (c.keywords.length) parts.push(c.keywords.join(", "));
  if (c.spec) parts.push(`quy cách ${c.spec}`);
  if (c.unit) parts.push(`đơn vị ${c.unit}`);
  if (c.include_sites.length) parts.push(`ưu tiên ${c.include_sites.join(", ")}`);
  if (c.exclude_sites.length) parts.push(`bỏ qua ${c.exclude_sites.join(", ")}`);
  if (c.region) parts.push(`khu vực ${c.region}`);
  if (parts.length) parts.push(c.vat === "incl" ? "giá đã gồm VAT" : "giá chưa VAT");
  if (c.watched_suppliers.length) parts.push(`theo dõi ${c.watched_suppliers.join(", ")}`);
  if (c.alert_pct != null) parts.push(`báo khi giá thấp nhất lệch giá vốn ${c.alert_pct}%`);
  if (c.alert_watched && c.watched_suppliers.length) parts.push("báo khi NCC theo dõi đổi giá");
  return parts.join(", ");
}

/** Form màn SP: ô yêu cầu = `instructions` đã lưu, chưa có ⇒ câu dựng từ ô cũ. */
export const toProductForm = (c: PriceScoutConfig): ScoutForm => ({
  ...toForm(c),
  instructions: c.instructions?.trim() ? c.instructions : legacyInstructions(c),
});

export const INSTRUCTIONS_MAX = 2000;

const orNull = (s: string): string | null => s.trim() || null;

/** % cảnh báo: trống ⇒ null; hợp lệ 1..100 nguyên; sai ⇒ NaN (để `scoutIssue` báo). */
export function parsePct(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : Number.NaN;
}

export function fromForm(f: ScoutForm): PriceScoutConfig {
  return {
    enabled: f.enabled,
    keywords: parseList(f.keywords),
    spec: orNull(f.spec),
    unit: orNull(f.unit),
    include_sites: parseList(f.include_sites).map((x) => x.toLowerCase()),
    exclude_sites: parseList(f.exclude_sites).map((x) => x.toLowerCase()),
    watched_suppliers: parseList(f.watched_suppliers),
    region: orNull(f.region),
    vat: f.vat,
    schedule: f.schedule,
    alert_pct: parsePct(f.alert_pct),
    alert_watched: f.alert_watched,
    instructions: orNull(f.instructions),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Chỉ các khoá KHÁC mặc định nhóm (để gửi `PUT`); trùng mặc định ⇒ để thừa kế. */
export function overrideOf(form: ScoutForm, defaults: PriceScoutConfig): PriceScoutOverride {
  const cfg = fromForm(form);
  const out: Record<string, unknown> = {};
  for (const k of CONFIG_KEYS) if (!same(cfg[k], defaults[k])) out[k] = cfg[k];
  return out as PriceScoutOverride;
}

/** Khoá nào đang theo mặc định nhóm (form trùng mặc định). */
export const inheritedKeys = (
  form: ScoutForm,
  defaults: PriceScoutConfig,
): Set<keyof PriceScoutConfig> => {
  const o = overrideOf(form, defaults);
  return new Set(CONFIG_KEYS.filter((k) => !(k in o)));
};

/** Mã lỗi nhập (khoá i18n con) hoặc null: danh sách quá dài, % ngoài 1..100. */
export function scoutIssue(form: ScoutForm): "listMax" | "pct" | "instructions" | null {
  if (form.instructions.length > INSTRUCTIONS_MAX) return "instructions";
  if (LIST_KEYS.some((k) => parseList(form[k]).length > LIST_MAX)) return "listMax";
  if (Number.isNaN(parsePct(form.alert_pct))) return "pct";
  return null;
}

/** Lượt dò đã dùng / trần tháng này; trần null ⇒ không giới hạn. */
export const usageView = (u: PriceScoutUsage): { used: number; limit: number | null } => ({
  used: u.searches,
  limit: u.searches_limit,
});

/** Chuỗi số trần nhập ở Cài đặt → số nguyên ≥ 0 hoặc null (trống); sai ⇒ undefined. */
export function parseCap(s: string): number | null | undefined {
  if (!s.trim()) return null;
  const n = Number(s.replace(/[.\s]/g, ""));
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}
