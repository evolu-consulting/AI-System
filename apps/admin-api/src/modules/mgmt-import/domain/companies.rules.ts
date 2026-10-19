// I1 · danh bạ công ty mgmt-app (index `companies`, `_id` = `<org>|tax:<số>` / `<org>|name:<…>`) dùng làm tra cứu: bên của sổ
// (party_key đích = `contracts.party_key(tên, MST)` tính trong SQL) và khách CKS. Thuần.
import { docsOf, type Snapshot } from "./context";
import { partyPart, str } from "./values.rules";

export type Company = { id: string; org: string; name: string | null; tax: string | null };

const TAX_RE = /^[0-9A-Za-z-]{1,30}$/;

export function companyIndex(s: Snapshot): Map<string, Company> {
  const out = new Map<string, Company>();
  for (const d of docsOf(s, "companies")) {
    const tax = str(d.src.tax_id, 30);
    out.set(d.id, {
      id: d.id,
      org: str(d.src.org_id, 128) ?? d.id.split("|")[0] ?? "",
      name: str(d.src.name, 200),
      tax: tax && TAX_RE.test(tax) ? tax : null,
    });
  }
  return out;
}

/** (tên, MST) cho `contracts.party_key` từ id công ty; công ty không có trong danh bạ ⇒ suy từ chính khoá. */
export function partyOf(
  companies: Map<string, Company>,
  companyId: string | null,
): { party_name: string | null; party_tax: string | null } {
  const c = companyId ? companies.get(companyId) : undefined;
  if (c) return { party_name: c.name, party_tax: c.tax };
  const part = partyPart(companyId);
  if (part?.startsWith("tax:")) return { party_name: null, party_tax: part.slice(4) };
  if (part?.startsWith("name:")) return { party_name: part.slice(5), party_tax: null };
  return { party_name: null, party_tax: null };
}

/** Khách CKS: tên (bắt buộc — dự phòng MST/khoá) + MST hợp lệ; khoá gộp trong tenant = MST hoặc tên thường. */
export function customerOf(
  companies: Map<string, Company>,
  companyId: string,
): { name: string; tax: string | null; key: string } {
  const c = companies.get(companyId);
  const p = partyOf(companies, companyId);
  const tax = c?.tax ?? (p.party_tax && TAX_RE.test(p.party_tax) ? p.party_tax : null);
  const name = c?.name ?? p.party_name ?? tax ?? companyId.slice(0, 200);
  return { name, tax, key: tax ? `tax:${tax}` : `name:${name.toLowerCase()}` };
}
