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

/** Id tenant theo khoá (platform admin; `GET /admin/tenants`). Ném lỗi rõ khi không có. */
export async function tenantIdByKey(admin: string, s: Session, key: string): Promise<string> {
  const { json } = await call<{ items?: { id: string; key: string }[] }>(
    `${admin}/admin/tenants?limit=200&q=${encodeURIComponent(key)}`,
    { method: "GET", token: s.token },
  );
  const hit = json.items?.find((t) => t.key === key);
  if (!hit) throw new Error(`tenantIdByKey: không thấy tenant "${key}"`);
  return hit.id;
}

/** Id quy trình thư viện theo TÊN (duyệt các trang `GET /process-defs`). Ném lỗi rõ khi không có. */
export async function libraryDefIdByName(hub: string, s: Session, name: string): Promise<string> {
  for (let cursor = ""; ; ) {
    const page = await call<{
      items: { id: string; name: string }[];
      next_cursor: string | null;
    }>(`${hub}/process-defs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, {
      method: "GET",
      token: s.token,
    });
    const hit = page.json.items.find((d) => d.name === name);
    if (hit) return hit.id;
    if (!page.json.next_cursor) throw new Error(`libraryDefIdByName: không thấy "${name}"`);
    cursor = page.json.next_cursor;
  }
}

/** CR-122 · platform_admin gán flow Thư viện cho công ty (`POST /tenants/:tid/company-flows`) — phần chuẩn bị, không phải bước được kiểm. */
export async function assignCompanyFlow(
  hub: string,
  s: Session,
  tenantId: string,
  flowId: string,
): Promise<void> {
  await call(`${hub}/tenants/${tenantId}/company-flows`, {
    method: "POST",
    token: s.token,
    body: JSON.stringify({ flow_id: flowId }),
  });
}

/** CR-122 · danh sách flow công ty (`GET /tenants/:tid/company-flows`). */
export async function companyFlows(
  hub: string,
  s: Session,
  tenantId: string,
): Promise<{ id: string; flow_id: string; name: string; enabled: boolean; kind: string }[]> {
  const r = await call<{ items: never[] }>(`${hub}/tenants/${tenantId}/company-flows`, {
    method: "GET",
    token: s.token,
  });
  return r.json.items;
}

type DefShape = {
  id: string;
  version: number;
  slot_body?: { steps?: Record<string, unknown>[] };
} & Record<string, unknown>;
const DEF_COPY_KEYS = [
  "description",
  "input_hint",
  "run_group_ids",
  "stages",
  "token_budget",
  "enabled",
  "sources",
  "inputs",
  "ttl_days",
] as const;
const SLOT_APPROVAL = "contracts.approval";

/**
 * Platform admin: nhân bản quy trình thư viện (theo `fromKey`) thành bản mới `key`/`name`, sửa các bước (`editSteps` nhận mảng bước của khe
 * duyệt, trả mảng mới) rồi XUẤT BẢN. Trả id quy trình thư viện mới. Giống thao tác ở trang Quy trình (Nhân bản → sửa → Xuất bản).
 */
export async function cloneAndPublishFlow(
  hub: string,
  s: Session,
  o: {
    fromKey: string;
    key: string;
    name: string;
    editSteps?: (steps: Record<string, unknown>[]) => Record<string, unknown>[];
  },
): Promise<string> {
  let from: { id: string; key: string } | undefined;
  for (let cursor = ""; !from; ) {
    const page = await call<{ items: { id: string; key: string }[]; next_cursor: string | null }>(
      `${hub}/process-defs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      { method: "GET", token: s.token },
    );
    from = page.json.items.find((d) => d.key === o.fromKey);
    if (!page.json.next_cursor) break;
    cursor = page.json.next_cursor;
  }
  if (!from) throw new Error(`cloneAndPublishFlow: không thấy quy trình thư viện "${o.fromKey}"`);
  const cloned = await call<{ id: string }>(`${hub}/process-defs/${from.id}/clone`, {
    method: "POST",
    token: s.token,
    body: JSON.stringify({ key: o.key, name: o.name }),
  });
  const id = cloned.json.id;
  const cur = (await call<DefShape>(`${hub}/process-defs/${id}`, { method: "GET", token: s.token }))
    .json;
  const steps = o.editSteps
    ? o.editSteps(cur.slot_body?.steps ?? [])
    : (cur.slot_body?.steps ?? []);
  const input = Object.fromEntries(DEF_COPY_KEYS.map((k) => [k, cur[k]]));
  const put = await call<{ version: number }>(`${hub}/process-defs/${id}`, {
    method: "PUT",
    token: s.token,
    body: JSON.stringify({
      ...input,
      key: o.key,
      name: o.name,
      slot: SLOT_APPROVAL,
      slot_body: { steps },
      version: cur.version,
    }),
  });
  await call(`${hub}/process-defs/${id}/publish`, {
    method: "POST",
    token: s.token,
    body: JSON.stringify({ version: put.json.version, note: "e2e" }),
  });
  return id;
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

/**
 * Chủ quản duyệt một bài theo id (cùng API nút "Duyệt" ở trang "Duyệt bài": `POST /pack/community/moderation/:id/decide`).
 * Bật duyệt bài ⇒ bài của chính chủ quản cũng phải duyệt. Không chờ hàng chờ: `taskId` vắng ⇒ server dùng lượt duyệt đang mở
 * (mở ngay trong transaction đăng bài). Ví dụ: `const p = await createPost(...); await approvePost("", host, p.id!);`
 */
export async function approvePost(base: string, s: Session, postId: string): Promise<void> {
  await call(
    `${base}/pack/community/moderation/${encodeURIComponent(postId)}/decide`,
    { method: "POST", token: s.token, body: JSON.stringify({ action: "approve" }) },
    undefined,
    s.fx,
  );
}

/** Id tính năng theo khoá (`GET /admin/features`). Ném lỗi rõ khi không có. */
export async function featureIdByKey(admin: string, s: Session, key: string): Promise<string> {
  const { json } = await call<{ items?: { id: string; key: string }[] }>(
    `${admin}/admin/features?limit=200`,
    { method: "GET", token: s.token },
  );
  const hit = json.items?.find((f) => f.key === key);
  if (!hit) throw new Error(`featureIdByKey: không thấy tính năng "${key}"`);
  return hit.id;
}

/** CR-124 · platform admin điền hồ sơ công ty (tên pháp lý + MST + địa chỉ) — `PATCH /admin/tenants/:id/profile` (đọc `version` trước). */
export async function setCompanyProfile(
  admin: string,
  s: Session,
  tenantId: string,
  p: { legal_name: string; tax_code: string; address: string },
): Promise<void> {
  const url = `${admin}/admin/tenants/${tenantId}/profile`;
  const cur = await call<{ version: number }>(url, { method: "GET", token: s.token });
  await call(url, {
    method: "PATCH",
    token: s.token,
    body: JSON.stringify({ version: cur.json.version, ...p }),
  });
}

/** CR-124 · quản trị công ty bật/tắt "Cho phép công ty khác tìm thấy và gửi HĐ cho chúng tôi" — `PUT /admin/tenants/:id/directory`. */
export async function setDirectoryListed(
  admin: string,
  s: Session,
  tenantId: string,
  listed: boolean,
): Promise<void> {
  await call(`${admin}/admin/tenants/${tenantId}/directory`, {
    method: "PUT",
    token: s.token,
    body: JSON.stringify({ listed }),
  });
}

/** Quản trị công ty tạo nhóm (`POST /admin/groups`) với khoá cho trước rồi thêm thành viên theo tên đăng nhập. Trả id nhóm. */
export async function createGroupWith(
  admin: string,
  s: Session,
  g: { key: string; name: string; usernames: string[] },
): Promise<string> {
  const made = await call<{ id: string }>(`${admin}/admin/groups`, {
    method: "POST",
    token: s.token,
    body: JSON.stringify({ key: g.key, name: { vi: g.name, en: g.name }, description: null }),
  });
  await call(`${admin}/admin/groups/${made.json.id}/members`, {
    method: "POST",
    token: s.token,
    body: JSON.stringify({ usernames: g.usernames }),
  });
  return made.json.id;
}
