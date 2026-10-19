// HD8-FR-09 · port `mgmt-app/api/app/routes/companies.py` (danh sách, tạo, sửa, tra lại Cục Thuế) — câu lỗi + mã như mgmt. Tra MST
// qua cổng `TaxRegistry` của HD2 (vắng cấu hình ⇒ coi như "chưa tra được"). Gọi Cục Thuế NGOÀI tx.
import type { Company, CompanyRow } from "@ai/contracts";
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { CompaniesRepo } from "../adapters/companies.repo";
import {
  applyRegistry,
  companyOrder,
  type Editable,
  matches,
  patchCompany,
} from "../domain/companies.rules";
import { partyKey } from "../domain/ledger.rules";
import type { TaxLookup } from "../domain/party.rules";
import { normalizeTaxId } from "../domain/warnings.rules";
import type { TaxRegistry } from "./extraction.ports";

export class CompanyFail extends Error {
  constructor(
    readonly status: 404 | 409 | 422 | 503,
    readonly detail = "",
  ) {
    super(detail);
  }
}
const BAD_TAX = "MST phải có 10 chữ số, 13 chữ số (chi nhánh) hoặc 12 chữ số (cá nhân)";

type Repos = { companies: CompaniesRepo };
export type CompaniesDeps = { uow: PackUow<Repos>; tax: TaxRegistry | null };

const lookup = async (d: CompaniesDeps, tax: string): Promise<TaxLookup> =>
  d.tax ? d.tax.lookup(tax, { fast: true }) : { result: "unavailable" };

const blank = (party: string, tax: string | null, name: string | null): Company => ({
  party,
  tax_id: tax,
  name,
  short_name: null,
  international_name: null,
  address: null,
  status: null,
  active: null,
  edited: [],
  registry_result: null,
  created_from: "manual",
});

/** MST (chuẩn hoá) + tên của thân "tạo"; sai ⇒ 422 đúng câu mgmt. */
function createInput(b: { tax_id?: string | null; name?: string | null }) {
  const name = b.name?.trim() || null;
  const raw = b.tax_id?.trim() || null;
  const tax = raw ? normalizeTaxId(raw) : null;
  if (raw && !tax) throw new CompanyFail(422, BAD_TAX);
  if (!tax && !name) throw new CompanyFail(422, "Cần MST hoặc tên công ty");
  return { name, tax };
}

/** Tra Cục Thuế khi có MST: không có ⇒ 422; chưa tra được mà không có tên ⇒ 503. */
async function withRegistry(d: CompaniesDeps, c: Company, tax: string | null, name: string | null) {
  if (!tax) return c;
  const look = await lookup(d, tax);
  if (look.result === "not_found") throw new CompanyFail(422, "MST không tồn tại theo Cục Thuế");
  if (look.result === "unavailable" && !name)
    throw new CompanyFail(503, "Chưa tra được Cục Thuế; nhập tên công ty để lưu trước");
  return applyRegistry(c, look);
}

export function companiesUsecase(d: CompaniesDeps) {
  const list = async (who: PackWho, q?: string): Promise<CompanyRow[]> => {
    const r = await d.uow.tenant(who, (x) => x.companies.list());
    const use = new Map(r.use.map((u) => [u.party, u]));
    return r.companies
      .filter((c) => matches(c, q))
      .sort(companyOrder)
      .map((c) => ({
        ...c,
        contract_count: use.get(c.party)?.contract_count ?? 0,
        roles: [...(use.get(c.party)?.roles ?? [])].sort(),
      }));
  };

  /** `create`: MST hoặc tên; MST tra Cục Thuế (không có ⇒ 422; chưa tra được mà không tên ⇒ 503); tên/địa chỉ người nhập thắng. */
  const create = async (
    who: PackWho,
    b: { tax_id?: string | null; name?: string | null; address?: string | null },
  ) => {
    const { name, tax } = createInput(b);
    let c = await withRegistry(d, blank(partyKey(name, tax) as string, tax, name), tax, name);
    const typed = patchCompany(c, { name, address: b.address ?? null });
    if (typed !== "empty_name") c = typed;
    const saved = await d.uow.tenant(who, (x) => x.companies.insert(c));
    if (!saved) throw new CompanyFail(409, "Công ty đã có trong danh bạ");
    return saved;
  };

  const update = (who: PackWho, party: string, body: Partial<Record<Editable, string | null>>) =>
    d.uow.tenant(who, async (x) => {
      const c = await x.companies.get(party, true);
      if (!c) throw new CompanyFail(404);
      const next = patchCompany(c, body);
      if (next === "empty_name") throw new CompanyFail(422, "Tên công ty không được để trống");
      return x.companies.save(next);
    });

  /** `refresh`: tra lại Cục Thuế (trừ trường người đã sửa). */
  const refresh = async (who: PackWho, party: string) => {
    const c = await d.uow.tenant(who, (x) => x.companies.get(party));
    if (!c) throw new CompanyFail(404);
    if (!c.tax_id) throw new CompanyFail(409, "Công ty chưa có MST");
    const look = await lookup(d, c.tax_id);
    if (look.result === "unavailable")
      throw new CompanyFail(503, "Chưa tra được Cục Thuế, thử lại sau ít phút");
    return d.uow.tenant(who, async (x) => {
      const now = await x.companies.get(party, true);
      if (!now) throw new CompanyFail(404);
      return x.companies.save(applyRegistry(now, look));
    });
  };

  return { list, create, update, refresh };
}
export type CompaniesUsecase = ReturnType<typeof companiesUsecase>;
