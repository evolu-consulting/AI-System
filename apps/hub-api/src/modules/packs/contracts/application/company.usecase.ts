// V2-L · CD-01: đọc/ghi cài đặt công ty. Đọc: mọi người có quyền đọc gói (sidebar/menu dùng tên, logo, màu); ghi: chỉ quản lý (route).
// Một tx đọc cả hai nguồn (bảng nhận diện + cờ duyệt); ghi chỉ cờ khi đổi (nhật ký duyệt chỉ ghi lúc đổi thật).
import type { CompanyIn, CompanyOut } from "@ai/contracts";
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { CompanyRepo } from "../adapters/company.repo";

export const DEFAULT_COMPANY: Omit<CompanyIn, "approval_enabled"> = {
  name: null,
  app_name: null,
  logo: null,
  accent: "indigo",
  theme: "auto",
  own_names: [],
  own_tax_ids: [],
};

export class CompanyFail extends Error {
  constructor(readonly detail: string) {
    super("invalid");
  }
}

/** MST đã chuẩn hoá về dạng so khớp (bỏ gạch) trùng nhau ⇒ báo lỗi; tên trùng (không phân biệt hoa/thường) cũng vậy. */
export function companyProblem(c: CompanyIn): string | null {
  const dup = (xs: string[]) => new Set(xs).size !== xs.length;
  if (dup(c.own_tax_ids.map((x) => x.replace("-", "")))) return "Mã số thuế bị trùng";
  if (dup(c.own_names.map((x) => x.toLocaleLowerCase("vi")))) return "Tên pháp nhân bị trùng";
  return null;
}

export function companyUsecase(d: { uow: PackUow<{ company: CompanyRepo }> }) {
  const tx = <T>(who: PackWho, fn: (r: CompanyRepo) => Promise<T>) =>
    d.uow.tenant(who, (r) => fn(r.company));
  const out = (
    s: Awaited<ReturnType<CompanyRepo["company"]>>,
    flag: Awaited<ReturnType<CompanyRepo["approval"]>>,
  ): CompanyOut => ({
    company: s?.company ?? DEFAULT_COMPANY,
    approval_enabled: flag.enabled,
    defaults: { ...DEFAULT_COMPANY, approval_enabled: flag.by_default },
    version: s?.version ?? 0,
    updated_at: s?.updated_at ?? null,
  });
  return {
    get: (who: PackWho): Promise<CompanyOut> =>
      tx(who, async (r) => out(await r.company(), await r.approval())),
    async save(who: PackWho, c: CompanyIn): Promise<CompanyOut> {
      const msg = companyProblem(c);
      if (msg) throw new CompanyFail(msg);
      const { approval_enabled, ...rest } = c;
      return tx(who, async (r) => {
        const before = await r.approval();
        if (before.enabled !== approval_enabled) await r.saveApproval(approval_enabled, who.userId);
        const saved = await r.saveCompany({ ...rest, approval_enabled });
        return out(saved, { ...before, enabled: approval_enabled });
      });
    },
  };
}
export type CompanyUsecase = ReturnType<typeof companyUsecase>;
