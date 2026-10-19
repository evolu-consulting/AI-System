// PK-FR-10 · N1 plan-frontend §1, §5, §7 · backend giả cho e2e khung contracts-web (không chứa test). Hình dữ liệu = contract:
// `TokenGrant` (packages/contracts/src/auth.ts), `PackMeResponse` (plan §2). Mọi chờ là chờ phần tử/route (tín hiệu), không sleep.
import type { Page, Route } from "@playwright/test";

export const TENANT = {
  id: "a1000000-0000-4000-8000-000000000001",
  key: "acme",
  name: "Acme Corp",
};
export type Role = "owner" | "editor" | "viewer";
export const ACTIONS: Record<Role, string[]> = {
  viewer: ["read"],
  editor: ["read", "write"],
  owner: ["read", "write", "admin"],
};
const me = (username: string) => ({
  id: "a1000000-0000-4000-8000-000000000065",
  tenant: TENANT,
  username,
  display_name: "Lan Nguyễn",
  email: `${username}@example.test`,
  role: "member",
  locale: "vi",
  must_change_password: false,
  totp_enabled: false,
  totp_enabled_at: null,
  backup_codes_left: 0,
});
export const grant = (username = "lan") => ({
  status: "authenticated",
  access_token: "e2e.access.token",
  token_type: "Bearer",
  expires_in: 900,
  user: me(username),
});
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export type Backend = {
  /** Số lần `/pack/contracts/me` được gọi. */
  meCalls: () => number;
  /** Header Authorization của lần gọi `/me` cuối. */
  lastAuth: () => string | null;
  /** Đặt trạng thái gói cho các lần `/me` kế. */
  setPack: (s: { enabled: boolean; actions: string[] } | "network" | "unauthorized") => void;
  /** Giữ `/me` lại tới khi gọi `release()` (kiểm trạng thái đang tải, không sleep). */
  hold: () => { release: () => void };
  logins: () => { tenant_key?: string; username?: string; password?: string }[];
};

/** Dựng backend giả. `session` = refresh cookie còn hạn (true ⇒ vào thẳng, không qua đăng nhập). */
export async function installBackend(
  page: Page,
  o: { session?: boolean; role?: Role; password?: string } = {},
): Promise<Backend> {
  let pack: Parameters<Backend["setPack"]>[0] = {
    enabled: true,
    actions: ACTIONS[o.role ?? "editor"],
  };
  let calls = 0;
  let auth: string | null = null;
  let gate: Promise<void> | null = null;
  const logins: ReturnType<Backend["logins"]> = [];
  let sessionOn = o.session ?? true;
  await page.route("**/auth/refresh", (r) =>
    sessionOn
      ? json(r, 200, grant())
      : json(r, 401, { error: { code: "UNAUTHORIZED", message: "Hết phiên" } }),
  );
  await page.route("**/auth/login", async (r) => {
    const body = r.request().postDataJSON() as {
      tenant_key?: string;
      username?: string;
      password?: string;
    };
    logins.push(body);
    if (body.password !== (o.password ?? "Mat-khau-dung-1")) {
      return json(r, 401, {
        error: { code: "INVALID_CREDENTIALS", message: "Sai thông tin đăng nhập" },
      });
    }
    sessionOn = true;
    return json(r, 200, grant(body.username));
  });
  await page.route("**/auth/logout", (r) => json(r, 204, {}));
  await page.route("**/pack/contracts/me", async (r) => {
    calls++;
    auth = r.request().headers().authorization ?? null;
    if (gate) await gate;
    if (pack === "network") return r.abort("connectionrefused");
    if (pack === "unauthorized")
      return json(r, 401, { error: { code: "UNAUTHORIZED", message: "Hết phiên" } });
    return json(r, 200, {
      pack: "contracts",
      enabled: pack.enabled,
      actions: pack.enabled ? pack.actions : [],
    });
  });
  return {
    meCalls: () => calls,
    lastAuth: () => auth,
    setPack: (s) => {
      pack = s;
    },
    hold: () => {
      let release: () => void = () => {};
      gate = new Promise<void>((res) => {
        release = () => {
          gate = null;
          res();
        };
      });
      return { release };
    },
    logins: () => logins,
  };
}
