import { describe, expect, test } from "bun:test";
import communityEn from "../locales/community/en.json";
import community from "../locales/community/vi.json";
import esignVi from "../locales/contracts/esign.vi.json";
import partnerEn from "../locales/contracts/partner.en.json";
import partnerVi from "../locales/contracts/partner.vi.json";
import workVi from "../locales/contracts/work.vi.json";
import adminEn from "../locales/en.json";
import adminVi from "../locales/vi.json";

type Obj = Record<string, unknown>;
const get = (o: Obj, path: string): unknown =>
  path.split(".").reduce((a: unknown, k) => (a as Obj | undefined)?.[k], o as unknown);

describe("CR-143 chữ hiển thị", () => {
  test("Bảng tin quản trị bỏ mô tả đầu trang, giữ hướng dẫn cho đối tác", () => {
    for (const c of [community, communityEn] as Obj[]) {
      expect(get(c, "community.flows.join.introHost")).toBeUndefined();
      expect(get(c, "community.flows.reports.intro")).toBeUndefined();
      expect(get(c, "community.flows.join.introPartner")).toBeString();
    }
  });
  test("Gửi và nhận hợp đồng với đối tác: cùng một nhãn ở workspace và admin", () => {
    const ws = get(partnerVi as Obj, "contracts.partner.confirm.title");
    expect(ws).toBe("Gửi và nhận hợp đồng với đối tác");
    expect(get(adminVi as Obj, "tenants.partner.title")).toBe(ws);
    expect(get(adminEn as Obj, "tenants.partner.title")).toBe(
      get(partnerEn as Obj, "contracts.partner.confirm.title"),
    );
  });
  test("Mô tả cài đặt Ký & đối tác đúng lời đã chốt", () => {
    expect(get(esignVi as Obj, "contracts.esign.settingHint")).toBe(
      "Bật: ký số trên hệ thống. Tắt: chỉ tải lên bản đã ký.",
    );
    expect(get(workVi as Obj, "contracts.work.u4.settings.signersHint")).toBe(
      "Người được ký hợp đồng khi bước Ký không chọn người cụ thể.",
    );
    expect(get(workVi as Obj, "contracts.work.u4.settings.hoursHint")).not.toContain("Ký số");
    expect(get(partnerVi as Obj, "contracts.partner.settings.importantHint")).toContain(
      "đánh dấu Quan trọng",
    );
    expect(get(partnerVi as Obj, "contracts.partner.settings.ownerHint")).toContain(
      "để trống thì quản trị công ty xử lý",
    );
  });
});
