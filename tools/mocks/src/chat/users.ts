// CHAT-AC-01, CHAT-AC-02 · tenant/user mẫu của mock chat (plan C1 §3.4). Mật khẩu dev chung, không phải secret.
import type { Me } from "@ai/contracts/chat";

export const MOCK_DEV_PASSWORD = "dev-password-1";

type MockTenant = { id: string; key: string; name: string };
export type MockUser = {
  id: string;
  tenant: MockTenant;
  username: string;
  display_name: string;
  locked: boolean;
};

const id = (n: string) => `00000000-0000-4000-8000-0000000c1${n}`;
const ACME: MockTenant = { id: id("a00"), key: "acme", name: "Acme" };
const BETA: MockTenant = { id: id("b00"), key: "beta", name: "Beta" };

// `username` = tên hiển thị viết thường.
const user = (n: string, tenant: MockTenant, display: string, locked = false) =>
  ({
    id: id(n),
    tenant,
    username: display.toLowerCase(),
    display_name: display,
    locked,
  }) satisfies MockUser;

/** `minh` có seed (B3); `lan`/`hoa` cùng tenant, rỗng; `an` khác tenant; `khoa` bị khoá. */
export const MOCK_USERS: readonly MockUser[] = [
  user("a01", ACME, "Minh"),
  user("a02", ACME, "Lan"),
  user("a03", ACME, "Hoa"),
  user("a04", ACME, "Khoa", true),
  user("b01", BETA, "An"),
];

/** Tìm theo `tenant_key` + `username` (đã chuẩn hoá chữ thường bởi `LoginRequestSchema`). */
export function findUser(tenantKey: string, username: string): MockUser | undefined {
  return MOCK_USERS.find((u) => u.tenant.key === tenantKey && u.username === username);
}

export function findUserById(userId: string): MockUser | undefined {
  return MOCK_USERS.find((u) => u.id === userId);
}

/** `Me` đủ trường như Admin: member, `vi`, chưa bật 2FA, không email. */
export function toMe(u: MockUser): Me {
  return {
    id: u.id,
    tenant: { ...u.tenant },
    username: u.username,
    display_name: u.display_name,
    email: null,
    role: "member",
    locale: "vi",
    must_change_password: false,
    totp_enabled: false,
    totp_enabled_at: null,
    backup_codes_left: 0,
  };
}
