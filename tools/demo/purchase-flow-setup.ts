// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: kịch bản demo đọc biến môi trường
// CR-125 · dựng công ty `muahang` + nhóm + người bằng API quản trị (phần chuẩn bị; quy trình dựng bằng UI ở `purchase-flow.ts`).
// Idempotent: có rồi thì giữ. Không in mật khẩu.
import { ADMIN_USER, DEMO_PW, email, ROLES, TENANT } from "./purchase-flow-data";

type Json = Record<string, unknown>;
export type Urls = { api: string; hub: string; web: string };

export const urlsFromBase = (base = Number(process.env.UAT_PORT_BASE ?? 3800)): Urls => ({
  web: `http://localhost:${base}`,
  api: `http://127.0.0.1:${base + 1}`,
  hub: `http://127.0.0.1:${base + 2}`,
});

async function call(
  base: string,
  method: string,
  path: string,
  token?: string,
  body?: Json,
  ok: number[] = [200, 201, 204],
): Promise<Json> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!ok.includes(res.status))
    throw new Error(`${method} ${path.replace(/\?.*/, "")} → ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as Json;
}

export async function login(
  base: string,
  tenantKey: string,
  username: string,
  password: string,
): Promise<Json> {
  return call(
    base,
    "POST",
    "/auth/login",
    undefined,
    { tenant_key: tenantKey, username, password },
    [200, 401],
  );
}

async function setPw(
  api: string,
  tenantKey: string,
  username: string,
  temp: string,
): Promise<void> {
  const r = await login(api, tenantKey, username, temp);
  if (r.status !== "password_change_required") return;
  await call(api, "POST", "/auth/change-password", undefined, {
    change_token: r.change_token,
    new_password: DEMO_PW,
  });
}

/** Đảm bảo user đăng nhập được bằng DEMO_PW (đặt lại mật khẩu tạm rồi đổi). */
async function ensurePw(
  api: string,
  tok: string,
  tenantId: string,
  username: string,
): Promise<void> {
  if ((await login(api, TENANT.key, username, DEMO_PW)).status === "authenticated") return;
  const q = await call(
    api,
    "GET",
    `/admin/users?tenant_id=${tenantId}&q=${username}&limit=50`,
    tok,
  );
  const user = (q.items as Json[]).find((x) => x.username === username);
  if (!user) throw new Error(`không thấy user ${username}`);
  const reset = await call(api, "POST", `/admin/users/${String(user.id)}/reset-password`, tok);
  await setPw(api, TENANT.key, username, String(reset.temp_password));
}

/** Người quản trị đầu tiên mặc định `en` ⇒ đặt `vi` để UI tiếng Việt. */
async function setLocaleVi(
  api: string,
  _tok: string,
  _tenantId: string,
  username: string,
): Promise<void> {
  const r = await login(api, TENANT.key, username, DEMO_PW);
  if (r.status !== "authenticated") return;
  await call(api, "PATCH", "/auth/me", String(r.access_token), { locale: "vi" });
}

export async function platformToken(api: string): Promise<string> {
  const r = await login(
    api,
    "platform",
    process.env.SEED_ADMIN_USERNAME || "admin",
    process.env.SEED_ADMIN_PASSWORD ?? "",
  );
  if (r.status !== "authenticated")
    throw new Error(`platform_admin đăng nhập: ${String(r.status)}`);
  return String(r.access_token);
}

export async function setupTenant(u: Urls): Promise<{ tenantId: string }> {
  const tok = await platformToken(u.api);
  // quản trị nền tảng dùng tiếng Việt (UI + nhãn canvas)
  await call(u.api, "PATCH", "/auth/me", tok, { locale: "vi" });
  const list = await call(u.api, "GET", `/admin/tenants?q=${TENANT.key}&limit=50`, tok);
  let tenantId = String(((list.items as Json[]).find((t) => t.key === TENANT.key) ?? {}).id ?? "");
  if (!tenantId) {
    const c = await call(u.api, "POST", "/admin/tenants", tok, {
      key: TENANT.key,
      name: TENANT.name,
      first_admin: {
        username: ADMIN_USER,
        display_name: "Quản trị Demo",
        email: email(ADMIN_USER),
      },
    });
    tenantId = String((c.tenant as Json).id);
  }
  await ensurePw(u.api, tok, tenantId, ADMIN_USER);
  await setLocaleVi(u.api, tok, tenantId, ADMIN_USER);
  // gói hợp đồng (Ký số + màn Hợp đồng) cho công ty
  await call(u.api, "PUT", `/admin/tenants/${tenantId}/packs/contracts`, tok, undefined);
  // nhóm
  const groupIds = new Map<string, string>();
  for (const r of Object.values(ROLES)) {
    if (groupIds.has(r.group)) continue;
    const q = await call(
      u.api,
      "GET",
      `/admin/groups?tenant_id=${tenantId}&q=${r.group}&limit=50`,
      tok,
    );
    let g = (q.items as Json[]).find((x) => x.key === r.group);
    if (!g) {
      const made = await call(u.api, "POST", `/admin/groups?tenant_id=${tenantId}`, tok, {
        key: r.group,
        name: { vi: r.groupName },
        description: null,
      });
      g = (made.group ?? made) as Json;
    }
    groupIds.set(r.group, String(g.id));
  }
  // người + vào nhóm
  for (const r of Object.values(ROLES)) {
    const q = await call(
      u.api,
      "GET",
      `/admin/users?tenant_id=${tenantId}&q=${r.user}&limit=50`,
      tok,
    );
    const have = (q.items as Json[]).find((x) => x.username === r.user);
    if (!have) {
      const c = await call(u.api, "POST", `/admin/users?tenant_id=${tenantId}`, tok, {
        username: r.user,
        display_name: r.display,
        role: "member",
        locale: "vi",
        email: email(r.user),
      });
      await setPw(u.api, TENANT.key, r.user, String(c.temp_password));
    }
    await ensurePw(u.api, tok, tenantId, r.user);
    await call(u.api, "POST", `/admin/groups/${groupIds.get(r.group)}/members`, tok, {
      usernames: [r.user],
    });
  }
  return { tenantId };
}

if (import.meta.main) {
  const u = urlsFromBase();
  console.log(JSON.stringify(await setupTenant(u)));
}
