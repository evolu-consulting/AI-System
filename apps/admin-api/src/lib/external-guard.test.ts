// CR-102a · com-c2-ext-deny · danh sách route admin-api đối tác được gọi (thuần).
import { describe, expect, test } from "bun:test";
import { externalRouteAllowed } from "./external-guard";

describe("externalRouteAllowed", () => {
  test("chỉ hồ sơ mình, đổi mật khẩu, đăng xuất, mã SSO, app/portal của mình", () => {
    for (const [m, p] of [
      ["GET", "/auth/me"],
      ["PATCH", "/auth/me/"],
      ["POST", "/auth/change-password"],
      ["POST", "/auth/logout"],
      ["POST", "/auth/sso/code"],
      ["GET", "/me/apps"],
      ["GET", "/auth/me/portal"],
      ["PUT", "/me/default-app"],
    ])
      expect({ m, p, ok: externalRouteAllowed(m as string, p as string) }).toEqual({
        m,
        p,
        ok: true,
      });
    for (const [m, p] of [
      ["DELETE", "/auth/me"],
      ["GET", "/admin/users"],
      ["GET", "/admin/external-orgs"],
      ["PUT", "/me/tenant-default-app"],
      ["GET", "/auth/feedback"],
      ["POST", "/auth/totp/setup"],
      ["GET", "/auth/me/apps/extra"],
    ])
      expect({ m, p, ok: externalRouteAllowed(m as string, p as string) }).toEqual({
        m,
        p,
        ok: false,
      });
  });
});
