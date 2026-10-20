// HD8-FR-09 · port `mgmt-app/api/app/companies/store.py` (`apply_registry`, EDITABLE) + `routes/companies.py` (`_haystack`, sắp xếp):
// danh bạ công ty theo khoá đối tác. Thuần.
import type { Company } from "./companies.types";
import { isActiveStatus, type TaxLookup } from "./party.rules";
import { searchForm } from "./scoring-config.rules";

export const EDITABLE = ["name", "international_name", "short_name", "address"] as const;
export type Editable = (typeof EDITABLE)[number];

/** `match_form`: NFD, bỏ dấu, chữ thường, cắt trắng (giữ "đ"). */
export const matchForm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .trim();

/** `_haystack`: chữ để tìm (tên, tên ngắn, tên quốc tế, MST). */
export const haystackOf = (c: Company): string =>
  searchForm([c.name, c.short_name, c.international_name, c.tax_id].filter(Boolean).join(" "));

/** Tìm theo mọi từ của `q` (search_form). */
export function matches(c: Company, q: string | undefined): boolean {
  if (!q?.trim()) return true;
  const hay = haystackOf(c);
  return searchForm(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** `apply_registry`: lấy điều Cục Thuế nói, trừ trường người đã sửa. Cổng tra MST không có địa chỉ ⇒ giữ địa chỉ cũ. */
export function applyRegistry(c: Company, look: TaxLookup): Company {
  if (look.result !== "found") return { ...c, registry_result: look.result };
  const keep = new Set(c.edited);
  const pick = <K extends keyof Company>(k: K, v: Company[K]) => (keep.has(k as string) ? c[k] : v);
  return {
    ...c,
    registry_result: "found",
    name: pick("name", look.name),
    short_name: pick("short_name", look.shortName ?? null),
    international_name: pick("international_name", look.internationalName ?? null),
    status: look.status,
    active: isActiveStatus(look.status),
  };
}

/** `update`: chỉ trường gửi lên (không null); chuỗi rỗng ⇒ null; tên không được rỗng; trường đã đổi ghi vào `edited`. */
export function patchCompany(
  c: Company,
  body: Partial<Record<Editable, string | null>>,
): Company | "empty_name" {
  const out: Company = { ...c, edited: [...c.edited] };
  for (const f of EDITABLE) {
    const raw = body[f];
    if (raw === null || raw === undefined) continue;
    const v = raw.trim() || null;
    if (f === "name" && !v) return "empty_name";
    if (v !== out[f]) {
      out[f] = v;
      if (!out.edited.includes(f)) out.edited.push(f);
    }
  }
  return out;
}

/** Danh bạ: sắp theo tên (`match_form`) — mgmt đưa pháp nhân của mình lên đầu (ngoài lát, D8-15). */
export const companyOrder = (a: Company, b: Company): number => {
  const x = matchForm(a.name ?? "");
  const y = matchForm(b.name ?? "");
  return x < y ? -1 : x > y ? 1 : 0;
};
