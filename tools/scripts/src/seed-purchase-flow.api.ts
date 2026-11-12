// CR-140 · phần dùng chung của seed-purchase-flow.ts và .trial.ts (đăng nhập, gọi API, địa chỉ dịch vụ) — để hai file không import lẫn nhau.
// biome-ignore lint/suspicious/noExplicitAny: JSON của API, đọc theo đường dẫn
export type Json = Record<string, any>;
export type Res = { status: number; json: Json };
export type Call = (method: string, path: string, body?: unknown) => Promise<Res>;

export const fail = (msg: string): never => {
  throw new Error(msg);
};
export const env = (k: string): string => process.env[k] || fail(`thiếu ${k} trong .env.local`);

export async function login(authUrl: string, tenant: string, username: string, password: string) {
  const res = await fetch(`${authUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_key: tenant, username, password }),
  });
  const j = (await res.json()) as Json;
  if (j.status !== "authenticated") fail(`đăng nhập ${tenant}/${username} → ${res.status}`);
  return String(j.access_token);
}
export const caller =
  (base: string, token: string): Call =>
  async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
  };
export const must = (r: Res, ok: number[], what: string): Json => {
  if (!ok.includes(r.status)) fail(`${what} → ${r.status} ${JSON.stringify(r.json).slice(0, 400)}`);
  return r.json;
};

export type Urls = { authUrl: string; hubUrl: string };
export const urls = (): Urls => ({
  authUrl: process.env.AUTH_URL || process.env.ADMIN_API_URL || "http://localhost:3001",
  hubUrl: process.env.HUB_URL || `http://localhost:${process.env.HUB_PORT || "4000"}`,
});
