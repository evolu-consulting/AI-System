// niti-onboard · dòng hồ sơ công ty ở chi tiết tenant (admin-web).
import { describe, expect, test } from "bun:test";
import en from "../../../../../../packages/i18n/locales/en.json";
import vi from "../../../../../../packages/i18n/locales/vi.json";
import { profileLines } from "./profile";

describe("niti-onboard · profileLines", () => {
  test("rỗng/không có ⇒ không dòng (thẻ ẩn)", () => {
    expect(profileLines(undefined)).toEqual([]);
    expect(profileLines({})).toEqual([]);
  });

  test("đủ trường ⇒ đúng thứ tự, website/điện thoại nối bằng ·; mọi nhãn có ở vi + en", () => {
    const lines = profileLines({
      legal_name: "CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ NITIGROUP",
      tax_id: "0318938091",
      websites: ["https://nitigroupvn.com/", "https://annamtax.com/"],
      phones: [
        { label: "Báo giá", number: "076.99.55.688" },
        { label: "Kỹ thuật", number: "0768.139.688" },
      ],
    });
    expect(lines).toEqual([
      ["legalName", "CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ NITIGROUP"],
      ["taxId", "0318938091"],
      ["websites", "https://nitigroupvn.com/ · https://annamtax.com/"],
      ["phones", "Báo giá: 076.99.55.688 · Kỹ thuật: 0768.139.688"],
    ]);
    for (const k of [
      "title",
      "legalName",
      "address",
      "taxId",
      "email",
      "websites",
      "zalo",
      "phones",
    ]) {
      expect(vi.tenants.profile).toHaveProperty(k);
      expect(en.tenants.profile).toHaveProperty(k);
    }
  });
});
