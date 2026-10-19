// HD1 · phần THUẦN của hạ tầng test (không import DB/fixture H1) — để `bun test tests/acceptance/HD1/rules` chạy không cần .env.local.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { noFeature, ROOT } from "../../N1/_support/load";

// ---------- hằng nghiệp vụ (spec HD-FR-02/03/04; R/api/app/contracts/fields.py) ----------
export const FIELD_KINDS = {
  number: "text",
  title: "text",
  type: "enum",
  supplier_name: "text",
  supplier_tax_id: "text",
  supplier_address: "text",
  supplier_representative: "text",
  buyer_name: "text",
  buyer_tax_id: "text",
  buyer_representative: "text",
  signed_date: "date",
  start_date: "date",
  end_date: "date",
  effective_date: "date",
  auto_renew: "bool",
  notice_days: "int",
  total_value: "int",
  vat_rate: "float",
  vat_included: "bool",
  payment_terms: "text",
  delivery_terms: "text",
  warranty: "text",
  penalty: "text",
} as const;
export type FieldKey = keyof typeof FIELD_KINDS;
export const FIELD_KEYS = Object.keys(FIELD_KINDS) as FieldKey[];
export const ITEM_KEYS = [
  "code",
  "name",
  "spec",
  "unit",
  "qty",
  "unit_price",
  "vat_rate",
  "moq",
  "lead_time_days",
  "valid_from",
  "valid_to",
] as const;
export const STATUSES = [
  "extracting",
  "extract_failed",
  "needs_review",
  "active",
  "expiring",
  "expired",
  "renewed",
  "terminated",
  "rejected",
] as const;
export const OUTCOMES = ["renewed", "not_renewed", "negotiating", "replaced"] as const;
export const emptyField = () => ({ value: null, quote: "", verified: false, edited: false });
/** Chỉ các khoá cho trước (thưa) — dùng để chèn HĐ "cũ thiếu khoá" (HD-AC12). */
export function mkFields(
  vals: Partial<Record<FieldKey, unknown>> = {},
  o: { edited?: FieldKey[]; quote?: string } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vals))
    out[k] = {
      value: v,
      quote: o.quote ?? "",
      verified: true,
      edited: (o.edited ?? []).includes(k as FieldKey),
    };
  return out;
}

// ---------- id cố định ----------
const x = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const cid = (n: number): string => x("c0de0000", n); // contracts.contracts
export const catId = (n: number): string => x("ca7e0000", n); // contracts.contract_categories
export const itemId = (n: number): string => x("17e00000", n); // contracts.contract_items
export const fileRowId = (n: number): string => x("f11e0000", n); // contracts.files
export const GHOST = cid(999_999);
export const OWNER_X = "0e0e0000-0000-4000-8000-000000000001"; // người phụ trách "ngoài" (uuid trần)

// ---------- nạp động (qc viết test TRƯỚC code) ----------

// biome-ignore lint/suspicious/noExplicitAny: module chưa tồn tại khi viết test
type Loose = Record<string, any>;
/** Hợp mọi export của `M/domain/*.rules.ts` (plan §4: chữ ký hàm; tên file do backend-lead chọn). Thiếu thư mục ⇒ đỏ ngay. */
export async function loadDomain(): Promise<Loose> {
  const dir = join(ROOT, "apps/hub-api/src/modules/packs/contracts/domain");
  if (!existsSync(dir)) noFeature("domain luật thuần hợp đồng", "T6", `thiếu ${dir}`);
  const files = readdirSync(dir).filter((f) => f.endsWith(".rules.ts"));
  if (files.length === 0) noFeature("domain luật thuần hợp đồng", "T6", "không có *.rules.ts");
  const all: Loose = {};
  for (const f of files) Object.assign(all, await import(join(dir, f)));
  return all;
}
/** Hàm domain theo tên (plan §4); thiếu ⇒ đỏ ngay "chưa có tính năng". */
export async function domainFn<F extends (...a: never[]) => unknown>(name: string): Promise<F> {
  const m = await loadDomain();
  if (typeof m[name] !== "function") noFeature(`hàm domain ${name}`, "T6");
  return m[name] as F;
}
export async function loadContractsPkg(): Promise<Loose> {
  const p = join(ROOT, "packages/contracts/src/pack-contracts/index.ts");
  if (!existsSync(p)) noFeature("contract zod gói hợp đồng", "T4", `thiếu ${p}`);
  return (await import(p)) as Loose;
}
export async function packDirsSrc(): Promise<string> {
  const p = join(ROOT, "packages/db/src/migrate-packs.ts");
  if (!existsSync(p)) noFeature("runPackMigrations", "N1 T5a", `thiếu ${p}`);
  return await Bun.file(p).text();
}

// ---------- tiếng Việt: nguồn độc lập với code sản phẩm ----------
/** Chữ có dấu tiếng Việt (thường) và chữ không dấu tương ứng — nguồn độc lập với code sản phẩm. */
export const VI_PAIRS: [string, string][] = [
  ["àáảãạ", "a"],
  ["ăằắẳẵặ", "a"],
  ["âầấẩẫậ", "a"],
  ["èéẻẽẹ", "e"],
  ["êềếểễệ", "e"],
  ["ìíỉĩị", "i"],
  ["òóỏõọ", "o"],
  ["ôồốổỗộ", "o"],
  ["ơờớởỡợ", "o"],
  ["ùúủũụ", "u"],
  ["ưừứửữự", "u"],
  ["ỳýỷỹỵ", "y"],
  ["đ", "d"],
];
/** LIKE (có thoát `\`) tự cài — kiểm ngữ nghĩa của mẫu độc lập với SQL. */
export function likeMatch(pattern: string, s: string): boolean {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i] as string;
    if (ch === "\\" && i + 1 < pattern.length)
      re += (pattern[++i] as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (ch === "%") re += "[\\s\\S]*";
    else if (ch === "_") re += "[\\s\\S]";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${re}$`).test(s);
}
