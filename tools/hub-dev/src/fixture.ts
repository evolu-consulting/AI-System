// HUB-H1-AC-01 · spec H1 §9 Q2 · H2b-R26: user fixture cho bộ contract chat với Hub thật, tạo qua admin-api bằng platform_admin.
// Idempotent: tenant/user đã có thì giữ, chỉ đặt lại mật khẩu khi đăng nhập bằng mật khẩu dev không được.
// Mật khẩu dev dùng chung (mock C1 plan §3.4), không phải secret.

export const DEV_PASSWORD = "dev-password-1";

type FixtureUser = {
  tenant_key: string;
  username: string;
  password: string;
  locked?: boolean;
  display_name?: string;
  role?: "member" | "tenant_admin";
  email?: string;
};

/** Khoá theo `tests/contract/chat/_env.ts` (`a`, `b`, `other_tenant`, `locked`). */
export const CONTRACT_USERS: Record<"a" | "b" | "other_tenant" | "locked", FixtureUser> = {
  a: { tenant_key: "acme", username: "lan", password: DEV_PASSWORD },
  b: { tenant_key: "acme", username: "hoa", password: DEV_PASSWORD },
  other_tenant: { tenant_key: "beta", username: "an", password: DEV_PASSWORD },
  locked: { tenant_key: "acme", username: "khoa", password: DEV_PASSWORD, locked: true },
};

/** Giá trị `CHAT_CONTRACT_USERS` (bỏ cờ nội bộ `locked`). */
export function contractUsersJson(): string {
  const strip = ({ tenant_key, username, password }: FixtureUser) => ({
    tenant_key,
    username,
    password,
  });
  const out = Object.fromEntries(Object.entries(CONTRACT_USERS).map(([k, u]) => [k, strip(u)]));
  return JSON.stringify(out);
}

type Json = Record<string, unknown>;
type Api = { base: string; token?: string };

async function call(api: Api, method: string, path: string, body?: Json): Promise<Json> {
  const res = await fetch(`${api.base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(api.token ? { Authorization: `Bearer ${api.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = (text ? JSON.parse(text) : {}) as Json;
  if (!res.ok) {
    const err = (json.error ?? {}) as Json;
    throw new Error(`${method} ${path} → ${res.status} ${String(err.code ?? text.slice(0, 120))}`);
  }
  return json;
}

const login = (base: string, tenant_key: string, username: string, password: string) =>
  call({ base }, "POST", "/auth/login", { tenant_key, username, password });

async function adminToken(base: string): Promise<string> {
  const username = process.env.SEED_ADMIN_USERNAME || "admin";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  const r = await login(base, "platform", username, password);
  if (r.status !== "authenticated")
    throw new Error(`platform_admin đăng nhập: ${String(r.status)}`);
  return String(r.access_token);
}

type FirstAdmin = { username: string; display_name: string; email: string };

/** Tạo tenant nếu chưa có; `firstAdmin` vắng ⇒ `tadmin` (CR-051: evolu dùng `julian.bui`, không sinh thêm `tadmin`). */
async function ensureTenant(
  api: Api,
  key: string,
  name = key.toUpperCase(),
  firstAdmin?: FirstAdmin,
): Promise<string> {
  const list = await call(api, "GET", `/admin/tenants?q=${key}&limit=50`);
  const hit = (list.items as Json[]).find((t) => t.key === key);
  if (hit) return String(hit.id);
  const created = await call(api, "POST", "/admin/tenants", {
    key,
    name,
    first_admin: firstAdmin ?? {
      username: "tadmin",
      display_name: "Tenant Admin",
      email: `tadmin@${key}.local`,
    },
  });
  return String((created.tenant as Json).id);
}

/** Mật khẩu tạm → đổi bắt buộc sang `DEV_PASSWORD` (luồng `password_change_required`). */
async function setDevPassword(api: Api, u: FixtureUser, temp: string): Promise<void> {
  const r = await login(api.base, u.tenant_key, u.username, temp);
  if (r.status !== "password_change_required") return;
  await call({ base: api.base }, "POST", "/auth/change-password", {
    change_token: r.change_token,
    new_password: u.password,
  });
}

async function devLoginOk(api: Api, u: FixtureUser): Promise<boolean> {
  try {
    return (await login(api.base, u.tenant_key, u.username, u.password)).status === "authenticated";
  } catch {
    return false;
  }
}

async function ensureUser(api: Api, tenantId: string, u: FixtureUser): Promise<void> {
  const q = `/admin/users?tenant_id=${tenantId}&q=${u.username}&limit=50`;
  let user = ((await call(api, "GET", q)).items as Json[]).find((x) => x.username === u.username);
  if (!user) {
    const body = {
      username: u.username,
      display_name: u.display_name ?? u.username,
      role: u.role ?? "member",
      locale: "vi",
      ...(u.email ? { email: u.email } : {}),
    };
    const created = await call(api, "POST", `/admin/users?tenant_id=${tenantId}`, body);
    user = created.user as Json;
    await setDevPassword(api, u, String(created.temp_password));
  } else if (user.status !== "locked" && !(await devLoginOk(api, u))) {
    const reset = await call(api, "POST", `/admin/users/${String(user.id)}/reset-password`);
    await setDevPassword(api, u, String(reset.temp_password));
  }
  if (u.locked && user.status !== "locked")
    await call(api, "POST", `/admin/users/${String(user.id)}/lock`);
}

/** H2b-R26 (F3): `lan` (acme) vào group `beta-testers` → dùng được agent seed `assistant`; `hoa` giữ ngoài (ca phủ định). */
export const BETA_TESTERS: Record<string, string[]> = { acme: ["lan"] };
const BETA_GROUP_KEY = "beta-testers";

/** Thêm idempotent (`POST …/members`: đã là thành viên → bỏ qua). Group do trigger Admin 0006 tạo cùng mọi tenant. */
async function ensureBetaTesters(api: Api, tenantId: string, usernames: string[]): Promise<void> {
  const list = await call(
    api,
    "GET",
    `/admin/groups?tenant_id=${tenantId}&q=${BETA_GROUP_KEY}&limit=50`,
  );
  const group = (list.items as Json[]).find((g) => g.key === BETA_GROUP_KEY);
  if (!group) throw new Error(`tenant ${tenantId} thiếu group ${BETA_GROUP_KEY}`);
  const res = await call(api, "POST", `/admin/groups/${String(group.id)}/members`, { usernames });
  const missing = (res.not_found as string[] | undefined) ?? [];
  if (missing.length > 0)
    throw new Error(`${BETA_GROUP_KEY}: không thấy user ${missing.join(", ")}`);
}

/** Tạo tenant `acme`, `beta` + user `lan, hoa, an, khoa(khoá)` qua admin-api tại `adminUrl`; `lan` vào `beta-testers`. */
export async function ensureContractFixture(adminUrl: string): Promise<void> {
  const api: Api = { base: adminUrl, token: await adminToken(adminUrl) };
  const tenantIds = new Map<string, string>();
  for (const u of Object.values(CONTRACT_USERS)) {
    let tid = tenantIds.get(u.tenant_key);
    if (!tid) {
      tid = await ensureTenant(api, u.tenant_key);
      tenantIds.set(u.tenant_key, tid);
    }
    await ensureUser(api, tid, u);
  }
  for (const [tenantKey, usernames] of Object.entries(BETA_TESTERS)) {
    const tid = tenantIds.get(tenantKey);
    if (tid) await ensureBetaTesters(api, tid, usernames);
  }
}

/** Dữ liệu demo do người dùng yêu cầu (2026-10-07, CR-051 2026-10-08: Rowan Nguyen): công ty `evolu`, 5 người; mật khẩu dev 10 ký tự (PASSWORD_MIN_LEN). */
export const DEMO_TENANT = { key: "evolu", name: "Evolu" };
export const DEMO_PASSWORD = "1234567890";
export const DEMO_USERS: FixtureUser[] = [
  ["julian.bui", "Julian Bui", "tenant_admin"],
  ["thomas.tran", "Thomas Tran", "member"],
  ["vio.ngo", "Vio Ngo", "member"],
  ["edgar.nguyen", "Edgar Nguyen", "member"],
  ["rowan.nguyen", "Rowan Nguyen", "member"],
].map(([username, display_name, role]) => ({
  tenant_key: DEMO_TENANT.key,
  username: String(username),
  display_name: String(display_name),
  role: role as FixtureUser["role"],
  email: `${String(username)}@evolu.local`,
  password: DEMO_PASSWORD,
}));

/** Gói bật cho tenant demo khi `scripts/dev-up.ps1` dựng máy dev: Sổ Hợp Tác + Community. */
export const DEMO_PACKS = ["contracts", "community"] as const;

/** Bật gói cho `evolu` và đưa user demo vào Group vai của gói: tenant_admin ⇒ owner, còn lại ⇒ editor. Sau `ensureDemoFixture`. */
export function ensureDemoPacks(adminUrl: string): Promise<void> {
  return ensureTenantPacks(adminUrl, {
    tenantKey: DEMO_TENANT.key,
    owners: DEMO_USERS.filter((u) => u.role === "tenant_admin").map((u) => u.username),
    editors: DEMO_USERS.filter((u) => u.role !== "tenant_admin").map((u) => u.username),
  });
}

/** Bật `DEMO_PACKS` cho tenant đã có (PUT idempotent, platform_admin) rồi đưa user vào Group `<gói>-owner` / `<gói>-editor`
 *  (Group do enablePack tạo; thêm thành viên idempotent). */
export async function ensureTenantPacks(
  adminUrl: string,
  t: { tenantKey: string; owners: string[]; editors: string[] },
): Promise<void> {
  const api: Api = { base: adminUrl, token: await adminToken(adminUrl) };
  const list = await call(api, "GET", `/admin/tenants?q=${t.tenantKey}&limit=50`);
  const hit = (list.items as Json[]).find((x) => x.key === t.tenantKey);
  if (!hit) throw new Error(`không có tenant ${t.tenantKey}`);
  for (const pack of DEMO_PACKS) {
    const state = await call(api, "PUT", `/admin/tenants/${String(hit.id)}/packs/${pack}`);
    const groups = (state.groups as Json[] | undefined) ?? [];
    await addPackMembers(api, pack, groups, "owner", t.owners);
    await addPackMembers(api, pack, groups, "editor", t.editors);
  }
  for (const key of DEMO_FEATURES) await grantFeature(api, key, String(hit.id));
}

/** Thêm user vào Group vai `role` của gói (idempotent); không có user ⇒ bỏ qua. */
async function addPackMembers(
  api: Api,
  pack: string,
  groups: Json[],
  role: "owner" | "editor",
  usernames: string[],
): Promise<void> {
  if (usernames.length === 0) return;
  const g = groups.find((x) => x.role === role);
  if (!g) throw new Error(`gói ${pack}: thiếu group vai ${role}`);
  const res = await call(api, "POST", `/admin/groups/${String(g.group_id)}/members`, { usernames });
  const missing = (res.not_found as string[] | undefined) ?? [];
  if (missing.length > 0) throw new Error(`${pack}-${role}: không thấy user ${missing.join(", ")}`);
}

/** Feature theo công ty bật cùng gói ở máy dev: duyệt HĐ trên engine (cần thêm env hub `CONTRACTS_APPROVAL_ENGINE=on`). */
export const DEMO_FEATURES = ["contracts-approval-engine"] as const;

/** Cấp entitlement (PUT idempotent, platform_admin) — như trang Features của Admin. */
async function grantFeature(api: Api, key: string, tenantId: string): Promise<void> {
  const list = await call(api, "GET", `/admin/features?q=${key}&limit=50`);
  const f = (list.items as Json[]).find((x) => x.key === key);
  if (!f) throw new Error(`không có feature ${key} (chưa db:migrate?)`);
  await call(api, "PUT", `/admin/features/${String(f.id)}/entitlements/${tenantId}`);
}

/** Tạo tenant `evolu` + 4 user demo (idempotent), tất cả vào `beta-testers` để dùng được agent seed. */
export async function ensureDemoFixture(adminUrl: string): Promise<void> {
  const api: Api = { base: adminUrl, token: await adminToken(adminUrl) };
  const [admin] = DEMO_USERS;
  const first = admin && {
    username: admin.username,
    display_name: admin.display_name ?? admin.username,
    email: admin.email ?? `${admin.username}@evolu.local`,
  };
  const tid = await ensureTenant(api, DEMO_TENANT.key, DEMO_TENANT.name, first);
  for (const u of DEMO_USERS) await ensureUser(api, tid, u);
  await ensureBetaTesters(
    api,
    tid,
    DEMO_USERS.map((u) => u.username),
  );
}
