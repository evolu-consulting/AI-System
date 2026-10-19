// PK-FR-10 · D-02 · N1 plan-frontend §6 (TF7) · dữ liệu giả CHUNG cho so màn hình contracts-web với mgmt-app thật.
// Một bộ dữ liệu chuẩn + hai bộ chuyển: `asMgmt()` (hình `mgmt-app/web/src/api/*.ts`) và `asHub()` (hình `@ai/contracts` +
// `/pack/contracts/me`). Mỗi lát (HD2…HD9) thêm dữ liệu cho màn của lát vào `dataset` rồi thêm hàng vào hai bộ chuyển.
export type Role = "owner" | "editor" | "viewer";

export const dataset = {
  tenant: { id: "a1000000-0000-4000-8000-000000000001", key: "acme", name: "Acme Corp" },
  user: {
    id: "a1000000-0000-4000-8000-000000000065",
    username: "lan",
    name: "Lan Nguyễn",
    email: "lan@acme.test",
  },
  /** S16: chuông N1 rỗng; HD4 thêm thông báo (dùng thời điểm cố định, không "giờ tương đối" trôi). */
  notices: [] as { id: string; title: string; body: string; at: string; read: boolean }[],
} as const;

const HUB_ACTIONS: Record<Role, string[]> = {
  viewer: ["read"],
  editor: ["read", "write"],
  owner: ["read", "write", "admin"],
};

/** Hình mgmt-app: `GET /api/auth/me`, `/api/notifications`, `/api/auth/options`. */
export function asMgmt(role: Role = "editor") {
  const d = dataset;
  return {
    me: {
      email: d.user.email,
      name: d.user.name,
      role: null,
      has_password: true,
      org: { id: d.tenant.id, name: d.tenant.name, role },
    },
    options: { signup: false },
    notices: d.notices.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      link: null,
      contract_id: null,
      created_at: n.at,
      read_at: n.read ? n.at : null,
    })),
  };
}

/** Hình hub: `TokenGrant` (`/auth/refresh`, `/auth/login`) + `PackMeResponse` (`/pack/contracts/me`). */
export function asHub(role: Role = "editor") {
  const d = dataset;
  return {
    grant: {
      status: "authenticated",
      access_token: "e2e.access.token",
      token_type: "Bearer",
      expires_in: 900,
      user: {
        id: d.user.id,
        tenant: d.tenant,
        username: d.user.username,
        display_name: d.user.name,
        email: d.user.email,
        role: "member",
        locale: "vi",
        must_change_password: false,
        totp_enabled: false,
        totp_enabled_at: null,
        backup_codes_left: 0,
      },
    },
    packMe: { pack: "contracts", enabled: true, actions: HUB_ACTIONS[role] },
  };
}
