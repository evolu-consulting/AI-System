// ADM-FR-21 · X1-R04 · client HTTP của `seed:dify` (admin-api + Hub `/agent-grants`), Bearer JWT. Lỗi chỉ mang tên bước +
// HTTP status + `error.code` — không bao giờ mang body request/response (body bước secret chứa key).

export class SeedStepError extends Error {
  constructor(
    readonly step: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(`${step}: HTTP ${status} ${code}`);
    this.name = "SeedStepError";
  }
}

export type Res = { status: number; body: Record<string, unknown> };
export type Req = {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  path: string;
  body?: unknown;
  /** Status chấp nhận (mặc định 200, 201); khác ⇒ `SeedStepError`. */
  ok?: number[];
};

export type Client = { call(step: string, req: Req): Promise<Res> };

function errCode(body: Record<string, unknown>): string {
  const e = body.error;
  const code = e && typeof e === "object" ? (e as Record<string, unknown>).code : undefined;
  return typeof code === "string" ? code : "UNKNOWN";
}

async function send(step: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    throw new SeedStepError(step, 0, typeof code === "string" ? code : "NETWORK_ERROR");
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function makeClient(base: string, token: string | null): Client {
  const root = base.replace(/\/+$/, "");
  return {
    async call(step, { method = "GET", path, body, ok = [200, 201] }) {
      const headers: Record<string, string> = { accept: "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      if (body !== undefined) headers["content-type"] = "application/json";
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const res = await send(step, `${root}${path}`, { method, headers, body: payload });
      const parsed = await readJson(res);
      if (!ok.includes(res.status)) throw new SeedStepError(step, res.status, errCode(parsed));
      return { status: res.status, body: parsed };
    },
  };
}

/** Bước 1: đăng nhập `platform_admin`. 2FA / đổi mật khẩu ⇒ lỗi (seed không xử lý). */
export async function login(adminUrl: string, username: string, password: string): Promise<string> {
  const anon = makeClient(adminUrl, null);
  const r = await anon.call("login", {
    method: "POST",
    path: "/auth/login",
    body: { tenant_key: "platform", username, password },
  });
  const token = r.body.access_token;
  if (r.body.status !== "authenticated" || typeof token !== "string")
    throw new SeedStepError("login", r.status, String(r.body.status ?? "NOT_AUTHENTICATED"));
  return token;
}

export const items = (r: Res): Record<string, unknown>[] =>
  Array.isArray(r.body.items) ? (r.body.items as Record<string, unknown>[]) : [];

export const qs = (o: Record<string, string | number | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) p.set(k, String(v));
  return `?${p.toString()}`;
};

/** List theo `q` rồi lọc khớp tuyệt đối theo `field` (q của API là khớp một phần). */
export async function findExact(
  c: Client,
  step: string,
  path: string,
  match: { field: string; value: string; query?: Record<string, string> },
): Promise<Record<string, unknown> | undefined> {
  const r = await c.call(step, {
    path: `${path}${qs({ ...match.query, q: match.value, limit: 200 })}`,
  });
  return items(r).find((i) => i[match.field] === match.value);
}
