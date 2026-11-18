// CR-181 · helper HTTP của seed ký (đăng nhập, gọi API, kiểm mã). Dùng chung `seed-cr181-sign.ts` + `.flows.ts`.
// biome-ignore lint/suspicious/noExplicitAny: JSON của API, đọc theo đường dẫn
export type Json = Record<string, any>;
export type Res = { status: number; json: Json };
export type Call = (method: string, path: string, body?: unknown) => Promise<Res>;

export const fail = (m: string): never => {
  throw new Error(m);
};
export const env = (k: string): string => process.env[k] || fail(`thiếu ${k}`);
export const must = (r: Res, ok: number[], what: string): Json =>
  ok.includes(r.status)
    ? r.json
    : fail(`${what} → ${r.status} ${JSON.stringify(r.json).slice(0, 240)}`);

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
    const form = body instanceof FormData;
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(form ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
  };
