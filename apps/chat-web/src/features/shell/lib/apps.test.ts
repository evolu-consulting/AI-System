// sso-switch · luật hiện mục app switcher theo URL cấu hình, vai và gói.
import { describe, expect, it } from "bun:test";
import { visibleApps } from "./apps";

const urls = { contracts: "http://c", admin: "http://a" };

describe("visibleApps", () => {
  it("member thấy Sổ Hợp Tác khi gói bật; quản trị thấy thêm Admin", () => {
    expect(visibleApps({ urls, role: "member", contractsEnabled: true })).toEqual(["contracts"]);
    expect(visibleApps({ urls, role: "tenant_admin", contractsEnabled: true })).toEqual([
      "contracts",
      "admin",
    ]);
  });

  it("gói tắt / thiếu URL ⇒ ẩn", () => {
    expect(visibleApps({ urls, role: "member", contractsEnabled: false })).toEqual([]);
    expect(
      visibleApps({
        urls: { contracts: "", admin: "" },
        role: "platform_admin",
        contractsEnabled: true,
      }),
    ).toEqual([]);
  });
});
