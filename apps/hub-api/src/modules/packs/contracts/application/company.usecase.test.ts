// V2-L · luật thuần của cài đặt công ty (trùng MST/tên, logo ≤ 1 MB, màu/giao diện) + "thử tính" điểm kinh doanh theo số mẫu.
import { describe, expect, it } from "bun:test";
import { BizPreviewSchema, COMPANY_LOGO_MAX_BYTES, CompanySchema, logoBytes } from "@ai/contracts";
import { DEFAULT_BIZ } from "../domain/business-score.rules";
import { businessUsecase } from "./business.usecase";
import { companyProblem } from "./company.usecase";

const base = CompanySchema.parse({
  name: " NITI ",
  app_name: "",
  logo: null,
  accent: "blue",
  theme: "light",
  own_names: ["NITI GROUP"],
  own_tax_ids: ["0312345678"],
  approval_enabled: true,
});

describe("V2-L · company", () => {
  it("chuẩn hoá: tên cắt khoảng trắng, rỗng ⇒ null; khoá lạ / màu lạ / MST sai bị từ chối", () => {
    expect([base.name, base.app_name]).toEqual(["NITI", null]);
    expect(CompanySchema.safeParse({ ...base, accent: "pink" }).success).toBe(false);
    expect(CompanySchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(CompanySchema.safeParse({ ...base, own_tax_ids: ["12"] }).success).toBe(false);
    expect(CompanySchema.safeParse({ ...base, own_tax_ids: ["0312345678-001"] }).success).toBe(
      true,
    );
  });

  it("logo: data URL ảnh ≤ 1 MB; ảnh lớn / URL ngoài / không phải ảnh bị từ chối", () => {
    expect(logoBytes("data:image/png;base64,iVBORw0KGgo=")).toBe(8);
    expect(logoBytes("data:text/html;base64,AAAA")).toBeNull();
    const big = `data:image/png;base64,${"A".repeat(Math.ceil((COMPANY_LOGO_MAX_BYTES * 4) / 3) + 8)}`;
    expect(CompanySchema.safeParse({ ...base, logo: big }).success).toBe(false);
    expect(CompanySchema.safeParse({ ...base, logo: "https://x.test/a.png" }).success).toBe(false);
    expect(
      CompanySchema.safeParse({ ...base, logo: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })
        .success,
    ).toBe(true);
  });

  it("trùng MST (bỏ gạch) hoặc trùng tên (hoa/thường) ⇒ báo lỗi", () => {
    expect(companyProblem(base)).toBeNull();
    expect(companyProblem({ ...base, own_tax_ids: ["0312345678", "0312345678"] })).toContain(
      "trùng",
    );
    expect(companyProblem({ ...base, own_tax_ids: ["0312345678001", "0312345678-001"] })).toContain(
      "trùng",
    );
    expect(companyProblem({ ...base, own_names: ["Niti", "NITI"] })).toContain("trùng");
  });
});

describe("V2-L · thử tính điểm kinh doanh", () => {
  const uc = businessUsecase({
    uow: {} as never,
    timeZoneOf: async () => "UTC",
    now: () => new Date(),
  });
  const sample = {
    kind: "stock" as const,
    held: 120,
    l3: 90,
    p3: 60,
    cost: 90_000,
    price: 120_000,
    dte: 200,
  };

  it("kho: 90 bán / 91 ngày, tồn 120 ⇒ đủ bán ~121 ngày; biên lãi 25% ⇒ yếu tố 100", () => {
    const r = uc.preview(BizPreviewSchema.parse({ config: DEFAULT_BIZ, sample }));
    expect(r.factors.map((f) => f.key)).toEqual(["rot", "margin", "trend"]);
    expect(r.factors[1]?.value).toBe(100);
    expect(r.score).toBeGreaterThan(50);
  });

  it("đổi ngưỡng đổi đề xuất; ngưỡng sai quan hệ ⇒ lỗi", () => {
    const a = uc.preview({ config: { ...DEFAULT_BIZ, dumpDays: 60, buyDays: 30 }, sample });
    expect(a.suggestion).toBe("dump");
    expect(() => uc.preview({ config: { ...DEFAULT_BIZ, lo: 70, hi: 60 }, sample })).toThrow();
  });
});
