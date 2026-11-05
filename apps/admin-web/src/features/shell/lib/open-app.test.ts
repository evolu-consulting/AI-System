// admin-sso-bounce · tái hiện: link "Cấu hình trong Sổ Hợp Tác" (màn Agents) mở thẳng URL app ⇒ Sổ Hợp Tác không có phiên ⇒ form
// đăng nhập. Link phải mang mã SSO một lần như app switcher.
import { describe, expect, test } from "bun:test";
import type { MeApp } from "@ai/contracts/app-catalog";
import { appOpenUrl } from "./open-app";

const SO: MeApp = {
  key: "contracts",
  name: { vi: "Sổ Hợp Tác" },
  icon: "file-text",
  url: "https://so.example.com",
  sso: true,
};
const grant = async (app: string) => ({
  code: `code-${app}`,
  target_url: "https://so.example.com/",
});

describe("appOpenUrl", () => {
  test("có phiên admin ⇒ trang /sso của Sổ Hợp Tác kèm mã một lần (không mở thẳng URL app)", async () => {
    const url = await appOpenUrl(SO, "/", { authed: true, grant });
    expect(url).toBe("https://so.example.com/sso#code=code-contracts&next=%2F");
  });

  test("xin mã lỗi / chưa có phiên ⇒ form đăng nhập của đích (không dội vòng)", async () => {
    const fail = async () => Promise.reject(new Error("403"));
    const login = "https://so.example.com/login?sso=none&next=%2F";
    expect(await appOpenUrl(SO, "/", { authed: true, grant: fail })).toBe(login);
    expect(await appOpenUrl(SO, "/", { authed: false, grant })).toBe(login);
  });

  test("app không SSO ⇒ URL app", async () => {
    const url = await appOpenUrl({ ...SO, sso: false }, "/", { authed: true, grant });
    expect(url).toBe("https://so.example.com");
  });
});
