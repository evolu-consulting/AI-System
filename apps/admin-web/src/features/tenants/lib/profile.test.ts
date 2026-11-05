// niti-onboard · CR-121 · kênh liên hệ khác của công ty ở tab Hồ sơ (admin-web).
import { describe, expect, test } from "bun:test";
import en from "../../../../../../packages/i18n/locales/en.json";
import vi from "../../../../../../packages/i18n/locales/vi.json";
import { profileLines } from "./profile";

describe("niti-onboard · profileLines", () => {
  test("rỗng/không có ⇒ không dòng (thẻ ẩn); khoá đã chuyển sang cột nhập tay không còn hiện từ jsonb", () => {
    expect(profileLines(undefined)).toEqual([]);
    expect(profileLines({})).toEqual([]);
    expect(profileLines({ legal_name: "Cty A", tax_id: "0312345678", address: "HN" })).toEqual([]);
  });

  test("đủ trường ⇒ đúng thứ tự, website/điện thoại nối bằng ·; mọi nhãn có ở vi + en", () => {
    const lines = profileLines({
      websites: ["https://a.example/", "https://b.example/"],
      zalo_oa: "oa-demo",
      phones: [
        { label: "Báo giá", number: "028.1111.2222" },
        { label: "Kỹ thuật", number: "028.3333.4444" },
      ],
    });
    expect(lines).toEqual([
      ["websites", "https://a.example/ · https://b.example/"],
      ["zalo", "oa-demo"],
      ["phones", "Báo giá: 028.1111.2222 · Kỹ thuật: 028.3333.4444"],
    ]);
    for (const k of ["title", "websites", "zalo", "phones"]) {
      expect(vi.tenants.profile).toHaveProperty(k);
      expect(en.tenants.profile).toHaveProperty(k);
    }
  });
});
