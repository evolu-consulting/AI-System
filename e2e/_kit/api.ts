// e2e/_kit · helper cấp API (không qua giao diện) để DỰNG dữ liệu hành trình: đăng nhập, gán quy trình, đặt luật, bật tính năng,
// tạo tenant/user/phòng ban riêng. Chỉ dùng để chuẩn bị; bước người dùng nhìn thấy vẫn phải đi bằng UI (D5).
// Dùng `fetch` chuẩn (Bun/Node ≥ 18), không cần trình duyệt. Mật khẩu/token không bao giờ được log.
import type {
  ProcessRouting,
  ProcessRoutingRuleInput,
  PutProcessRoutingRequest,
} from "@ai/contracts/hub-admin";
import { uniqueKey, uniqueSuffix } from "./unique";

export type Session = {
  /** access token (Bearer). */
  token: string;
  /** Header sẵn dùng cho các gọi sau. */
  headers: Record<string, string>;
  /** Giá trị `Set-Cookie` của refresh (nếu API trả), để nạp vào context trình duyệt khi cần phiên cookie. */
  setCookie: string[];
  /** fetch dùng cho các gọi sau (mặc định fetch toàn cục; `pageFetch` chạy trong trình duyệt). */
  fx?: typeof fetch;
};

export type LoginArgs = {
  /** Gốc API đăng nhập (admin-api hoặc origin web đã proxy `/auth`). */
  base: string;
  tenantKey: string;
  username: string;
  password: string;
  /** Header `X-App` (mặc định "admin"; web hợp đồng dùng "contracts"). */
  app?: string;
  /** fetch tuỳ chọn (vd `pageFetch(page)` khi API chỉ gọi được qua origin của trình duyệt). */
  fx?: typeof fetch;
};

async function call<T>(
  url: string,
  init: RequestInit & { token?: string },
  ok: readonly number[] = [200, 201, 204],
  fx: typeof fetch = fetch,
): Promise<{ status: number; json: T; raw: Response }> {
  const { token, headers, ...rest } = init;
  const res = await fx(url, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  if (!ok.includes(res.status)) {
    // Không in body đầy đủ (có thể chứa dữ liệu nhạy cảm): chỉ mã + 200 ký tự.
    throw new Error(
      `${init.method ?? "GET"} ${url.replace(/\?.*/, "")} → ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  return { status: res.status, json: (text ? JSON.parse(text) : undefined) as T, raw: res };
}

/** Đăng nhập bằng API: trả access token + header Bearer. `const s = await apiLogin({...}); fetch(url, {headers: s.headers})`. */
export async function apiLogin(a: LoginArgs): Promise<Session> {
  const { json, raw } = await call<{ access_token?: string }>(
    `${a.base}/auth/login`,
    {
      method: "POST",
      headers: { "X-App": a.app ?? "admin" },
      body: JSON.stringify({
        tenant_key: a.tenantKey,
        username: a.username,
        password: a.password,
      }),
    },
    undefined,
    a.fx,
  );
  if (!json?.access_token) throw new Error("apiLogin: phản hồi không có access_token");
  const setCookie = raw.headers.getSetCookie?.() ?? [];
  return {
    token: json.access_token,
    headers: { authorization: `Bearer ${json.access_token}` },
    setCookie,
    fx: a.fx,
  };
}

/** Platform admin gán quy trình thư viện `defId` cho tenant × khe. Chạy lại được (PUT idempotent). */
export async function assignProcess(
  hub: string,
  s: Session,
  tenantId: string,
  slot: string,
  defId: string,
): Promise<void> {
  await call(
    `${hub}/tenants/${encodeURIComponent(tenantId)}/process-routing/${encodeURIComponent(slot)}/processes/${encodeURIComponent(defId)}`,
    { method: "PUT", token: s.token },
  );
}

/** Đặt (thay cả danh sách) luật chọn quy trình của tenant × khe; tự đọc `version` hiện tại. Thứ tự mảng = ưu tiên. */
export async function setRoutingRules(
  hub: string,
  s: Session,
  tenantId: string,
  slot: string,
  rules: ProcessRoutingRuleInput[],
): Promise<ProcessRouting> {
  const url = `${hub}/tenants/${encodeURIComponent(tenantId)}/process-routing/${encodeURIComponent(slot)}`;
  const cur = await call<ProcessRouting>(url, { method: "GET", token: s.token });
  const body: PutProcessRoutingRequest = { version: cur.json.version, rules };
  const put = await call<ProcessRouting>(url, {
    method: "PUT",
    token: s.token,
    body: JSON.stringify(body),
  });
  return put.json;
}

/** Bật tính năng (entitlement) cho tenant: `PUT /admin/features/:featureId/entitlements/:tenantId`. */
export async function grantFeature(
  admin: string,
  s: Session,
  featureId: string,
  tenantId: string,
): Promise<void> {
  await call(`${admin}/admin/features/${featureId}/entitlements/${tenantId}`, {
    method: "PUT",
    token: s.token,
  });
}

/** Tắt tính năng cho tenant (bỏ cấp). */
export async function revokeFeature(
  admin: string,
  s: Session,
  featureId: string,
  tenantId: string,
): Promise<void> {
  await call(
    `${admin}/admin/features/${featureId}/entitlements/${tenantId}`,
    { method: "DELETE", token: s.token },
    [200, 204, 404],
  );
}

export type IsolatedTenant = { suffix: string; key: string; name: string; json: unknown };

/** Tạo tenant riêng của spec (key/tên có hậu tố duy nhất) cùng admin đầu tiên. Platform admin. `json` = phản hồi gốc (có id, mật khẩu tạm). */
export async function createIsolatedTenant(
  admin: string,
  s: Session,
  prefix = "t",
): Promise<IsolatedTenant> {
  const suffix = uniqueSuffix();
  const key = uniqueKey(prefix, suffix);
  const { json } = await call<unknown>(`${admin}/admin/tenants`, {
    method: "POST",
    token: s.token,
    body: JSON.stringify({
      key,
      name: `E2E ${prefix} ${suffix}`,
      first_admin: {
        username: `${key}-admin`,
        display_name: `Admin ${suffix}`,
        email: `${key}-admin@example.test`,
        locale: "vi",
      },
    }),
  });
  return { suffix, key, name: `E2E ${prefix} ${suffix}`, json };
}

/** Tạo user riêng (tenant admin/platform admin trong ngữ cảnh tenant của phiên). Trả phản hồi (user + temp_password). */
export async function createIsolatedUser(
  admin: string,
  s: Session,
  prefix = "u",
  role: "member" | "tenant_admin" = "member",
): Promise<{ suffix: string; username: string; json: unknown }> {
  const suffix = uniqueSuffix();
  const username = uniqueKey(prefix, suffix);
  const { json } = await call<unknown>(`${admin}/admin/users`, {
    method: "POST",
    token: s.token,
    body: JSON.stringify({
      username,
      display_name: `E2E ${prefix} ${suffix}`,
      email: `${username}@example.test`,
      role,
      locale: "vi",
    }),
  });
  return { suffix, username, json };
}

/** Tạo phòng ban/nhóm riêng (`POST /admin/groups`). Trả phản hồi gốc (có id). */
export async function createIsolatedDept(
  admin: string,
  s: Session,
  prefix = "dept",
): Promise<{ suffix: string; key: string; name: string; json: unknown }> {
  const suffix = uniqueSuffix();
  const key = uniqueKey(prefix, suffix);
  const name = `E2E ${prefix} ${suffix}`;
  const { json } = await call<unknown>(`${admin}/admin/groups`, {
    method: "POST",
    token: s.token,
    body: JSON.stringify({ key, name, description: null }),
  });
  return { suffix, key, name, json };
}

/** Chủ quản đăng bài bằng API community (`POST /pack/community/posts`), audience tường minh (mặc định mọi bạn bè). Trả phản hồi gốc (có id). `base` = origin web (proxy `/pack`). */
export async function createPost(
  base: string,
  s: Session,
  input: {
    type: "note" | "sell" | "buy";
    title?: string;
    body: string;
    audience?: {
      mode: "all" | "suppliers" | "buyers" | "cats";
      cats?: string[];
      companies?: string[];
    };
  },
): Promise<{ id?: string }> {
  const { json } = await call<{ id?: string }>(
    `${base}/pack/community/posts`,
    {
      method: "POST",
      token: s.token,
      body: JSON.stringify({
        type: input.type,
        title: input.title ?? "",
        body: input.body,
        fields: {},
        cats: [],
        media: [],
        audience: { mode: "all", cats: [], companies: [], ...input.audience },
      }),
    },
    undefined,
    s.fx,
  );
  return json;
}

/** `fetch` chạy TRONG trang (cùng origin, qua proxy của web) — dùng khi Node không nối thẳng được tới origin web. `base` nên là "" (đường dẫn gốc). */
export function pageFetch(page: import("@playwright/test").Page): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const r = await page.evaluate(
      async ([u, i]) => {
        const res = await fetch(u as string, i as RequestInit);
        return { status: res.status, text: await res.text() };
      },
      [url, init ?? {}] as const,
    );
    return new Response(r.text, { status: r.status });
  }) as typeof fetch;
}
