// dlc-dify · client console API Dify 1.18 (chỉ dùng cho seed dev): đăng nhập (mật khẩu base64 → cookie access/csrf),
// tìm app theo tên, import DSL (tạo mới hoặc ghi đè `app_id`), publish workflow, lấy/tạo API key app. Không log secret.

export type DifyConsole = {
  findApp(name: string): Promise<string | null>;
  importApp(yaml: string, appId: string | null): Promise<string>;
  publish(appId: string): Promise<void>;
  apiKey(appId: string): Promise<string>;
};

type Jar = { cookie: string; csrf: string };

function cookieOf(res: Response): Jar {
  const raw = res.headers.getSetCookie();
  const pairs = raw.map((c) => c.split(";")[0] as string);
  const csrf = pairs.find((p) => /csrf_token=/.test(p))?.split("=")[1] ?? "";
  return { cookie: pairs.join("; "), csrf };
}

export async function difyConsole(
  base: string,
  email: string,
  password: string,
): Promise<DifyConsole> {
  const root = base.replace(/\/+$/, "");
  const login = await fetch(`${root}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: Buffer.from(password).toString("base64"),
      remember_me: true,
    }),
  });
  if (!login.ok) throw new Error(`dify login: HTTP ${login.status}`);
  const jar = cookieOf(login);
  const call = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> => {
    const res = await fetch(`${root}${path}`, {
      method,
      headers: {
        Cookie: jar.cookie,
        "X-CSRF-Token": jar.csrf,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok)
      throw new Error(`dify ${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  };
  return {
    async findApp(name) {
      const r = await call("GET", `/apps?page=1&limit=100&name=${encodeURIComponent(name)}`);
      const hit = ((r.data as { id: string; name: string }[]) ?? []).find((a) => a.name === name);
      return hit?.id ?? null;
    },
    async importApp(yaml, appId) {
      const r = await call("POST", "/apps/imports", {
        mode: "yaml-content",
        yaml_content: yaml,
        ...(appId ? { app_id: appId } : {}),
      });
      let res = r;
      if (r.status === "pending")
        res = await call("POST", `/apps/imports/${r.id as string}/confirm`, {});
      if (res.status !== "completed" && res.status !== "completed-with-warnings")
        throw new Error(`dify import: ${String(res.status)} ${String(res.error ?? "")}`);
      return res.app_id as string;
    },
    async publish(appId) {
      await call("POST", `/apps/${appId}/workflows/publish`, {});
    },
    async apiKey(appId) {
      const r = await call("GET", `/apps/${appId}/api-keys`);
      const first = ((r.data as { token: string }[]) ?? [])[0];
      if (first) return first.token;
      const c = await call("POST", `/apps/${appId}/api-keys`, {});
      return c.token as string;
    },
  };
}
