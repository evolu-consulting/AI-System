// HUB-FR-72 · e2e studio-web: API giả lập bằng `page.route` (spec §7 "test FE: mock http"), dữ liệu cố định theo contract
// `@ai/contracts/studio` (plan §2) — không import contract để file chạy được trước B1. Không chứa `test(...)`.
// Mỗi ca: `mockStudio(page, o)` dựng kho trong bộ nhớ; `calls` ghi lại request (method + path + body) để khẳng định.
import { expect, type Page, type Request } from "@playwright/test";

const u = (n: number) => `e4a0e000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ID = {
  padmin: u(1),
  tadmin: u(2),
  platform: u(10),
  acme: u(11),
  beta: u(12),
  profFake: u(20),
  orch: u(30),
  hoadon: u(31),
  helper: u(32),
  difyTom: u(33),
  wfTom: u(40),
  wfDich: u(41),
} as const;
export const PASSWORD = "dev-password-1";
const NOW = "2026-10-06T08:00:00.000Z";

type Role = "platform_admin" | "tenant_admin" | "member";
const authUser = (role: Role) => ({
  id: role === "platform_admin" ? ID.padmin : ID.tadmin,
  tenant:
    role === "platform_admin"
      ? { id: ID.platform, key: "platform", name: "Platform" }
      : { id: ID.acme, key: "acme", name: "Acme Corp" },
  username: role === "platform_admin" ? "padmin" : "tadmin",
  display_name: role === "platform_admin" ? "P Admin" : "T Admin",
  email: null,
  role,
  locale: "vi",
  must_change_password: false,
  totp_enabled: false,
  totp_enabled_at: null,
  backup_codes_left: 0,
});

type Agent = Record<string, unknown> & {
  id: string;
  key: string;
  version: number;
  enabled: boolean;
};
const agent = (id: string, key: string, o: Record<string, unknown> = {}): Agent => ({
  id,
  key,
  name: { vi: `Tên ${key}`, en: `Name ${key}` },
  description: `Agent ${key} dùng cho kiểm thử giao diện Studio.`,
  runtime: "agentic-cli",
  agent_type_key: null,
  profile_id: ID.profFake,
  system_prompt: "",
  runtime_options: { cli: "claude", allowed_tools: ["Read", "Grep"], mcp: false, cwd_mode: "job" },
  workflow_ids: [],
  workflows: [],
  timeout_s: 600,
  token_budget: null,
  enabled: true,
  version: 1,
  created_at: NOW,
  updated_at: NOW,
  runnable: true,
  orchestrator_of: { default: false, tenant_ids: [] },
  warnings: [],
  ...o,
});

export type Store = {
  version: number;
  agents: Agent[];
  entitled: Record<string, number>;
  calls: { method: string; path: string; body: unknown }[];
};
export function seedStore(): Store {
  return {
    version: 7,
    agents: [
      agent(ID.orch, "orchestrator", { orchestrator_of: { default: true, tenant_ids: [] } }),
      agent(ID.hoadon, "hoadon"),
      agent(ID.helper, "helper", { runtime: "llm", runtime_options: {} }),
      agent(ID.difyTom, "dify-tom", {
        runtime: "dify-workflow",
        profile_id: null,
        runtime_options: { workflow_key: "tom" },
        workflow_ids: [ID.wfTom],
      }),
    ],
    entitled: { [ID.orch]: 0, [ID.hoadon]: 2, [ID.helper]: 0, [ID.difyTom]: 1 },
    calls: [],
  };
}

const listItem = (s: Store, a: Agent) => ({
  id: a.id,
  key: a.key,
  name: a.name,
  description: a.description,
  runtime: a.runtime,
  enabled: a.enabled,
  version: a.version,
  updated_at: a.updated_at,
  profile: a.profile_id ? { id: a.profile_id, key: "fake-1" } : null,
  workflow_count: (a.workflow_ids as string[]).length,
  entitled_tenant_count: s.entitled[a.id] ?? 0,
  orchestrator_of: a.orchestrator_of,
  runnable: a.runnable,
});
const list = (items: unknown[], s: Store) => ({
  items,
  total: items.length,
  truncated: false,
  hub_config_version: s.version,
});
const err = (code: string, message: string, details?: unknown) => ({
  error: { code, message, ...(details ? { details } : {}) },
});

export type MockOpts = {
  /** Role trả về khi đăng nhập; khác platform_admin ⇒ `/studio/api/*` 403. */
  role?: Role;
  /** `/auth/refresh` có phiên sẵn (true) hay 401 (mặc định). */
  session?: boolean;
  store?: Store;
  /** Ghi đè phản hồi một lần cho `METHOD path` (vd 409 xung đột). */
  once?: Record<string, { status: number; body: unknown }>;
};

/** Cài mock `/auth/*` + `/studio/api/*`; trả kho để ca đọc/khẳng định. */
export async function mockStudio(page: Page, o: MockOpts = {}): Promise<Store> {
  const s = o.store ?? seedStore();
  const role = o.role ?? "platform_admin";
  const once = { ...(o.once ?? {}) };
  let loggedIn = !!o.session;
  const grant = () => ({
    status: "authenticated",
    access_token: `tok-${role}`,
    token_type: "Bearer",
    expires_in: 900,
    user: authUser(role),
  });

  await page.route(/\/auth\//, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith("/auth/login")) {
      const b = req.postDataJSON() as { password?: string };
      if (b?.password !== PASSWORD)
        return route.fulfill({
          status: 401,
          json: err("INVALID_CREDENTIALS", "Invalid credentials"),
        });
      loggedIn = true;
      return route.fulfill({ status: 200, json: grant() });
    }
    if (path.endsWith("/auth/refresh"))
      return loggedIn
        ? route.fulfill({ status: 200, json: grant() })
        : route.fulfill({ status: 401, json: err("AUTH_EXPIRED", "Expired") });
    if (path.endsWith("/auth/logout")) {
      loggedIn = false;
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ status: 404, json: err("NOT_FOUND", "Not found") });
  });

  await page.route(/\/studio\/api\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/studio\/api/, "");
    const method = req.method();
    const body = req.postData() ? req.postDataJSON() : undefined;
    s.calls.push({ method, path, body });
    const key = `${method} ${path}`;
    if (once[key]) {
      const r = once[key];
      delete once[key];
      return route.fulfill({ status: r.status, json: r.body });
    }
    if (role !== "platform_admin")
      return route.fulfill({ status: 403, json: err("FORBIDDEN", "Forbidden") });
    return route.fulfill(handle(s, method, path, body));
  });
  return s;
}

type Body = { [k: string]: unknown } | undefined;
type Out = { status: number; json?: unknown; body?: string };
type Handler = (s: Store, m: RegExpMatchArray, body: Body) => Out;
const notFound = (): Out => ({ status: 404, json: err("NOT_FOUND", "Not found") });
const byId = (s: Store, id: string | undefined) => s.agents.find((a) => a.id === id);

function createAgent(s: Store, body: Body): Out {
  const opts = (body?.runtime_options ?? {}) as { allowed_tools?: string[] };
  if ((opts.allowed_tools ?? []).includes("Bash") && body?.bash_ack !== true)
    return { status: 422, json: err("BASH_ACK_REQUIRED", "Bash ack required") };
  s.version += 1;
  const a = agent(u(900 + s.agents.length), String(body?.key), { ...body, bash_ack: undefined });
  s.agents.push(a);
  return { status: 201, json: { agent: a, hub_config_version: s.version } };
}
function putAgent(s: Store, id: string | undefined, body: Body): Out {
  const a = byId(s, id);
  if (!a) return notFound();
  if (body?.version !== a.version)
    return {
      status: 409,
      json: err("VERSION_CONFLICT", "Version conflict", { current: a, updated_at: a.updated_at }),
    };
  Object.assign(a, { ...body, version: a.version + 1 });
  s.version += 1;
  return { status: 200, json: { agent: a, hub_config_version: s.version } };
}
function patchEnabled(s: Store, id: string | undefined, body: Body): Out {
  const a = byId(s, id);
  if (!a) return notFound();
  a.enabled = body?.enabled === true;
  a.version += 1;
  s.version += 1;
  return { status: 200, json: { agent: a, hub_config_version: s.version } };
}
function orchestrator(s: Store): Out {
  const o = byId(s, ID.orch) as Agent;
  const def = {
    id: 1,
    tenant: null,
    agent: { id: o.id, key: o.key, name: o.name, runtime: o.runtime, enabled: true },
    max_steps: 5,
    token_budget: 200000,
    history_n: 10,
    on_no_match: "answer",
    version: 1,
    updated_by: null,
    updated_at: NOW,
    warnings: ["agentic_cli_slow"],
  };
  return { status: 200, json: { default: def, tenants: [], hub_config_version: s.version } };
}
const WORKFLOWS = [
  {
    id: ID.wfTom,
    key: "tom",
    name: "Tóm tắt",
    description: "Tóm tắt văn bản dài thành vài ý chính.",
    app_type: "workflow",
    usable_for: ["tool", "dify-workflow"],
  },
  {
    id: ID.wfDich,
    key: "dich",
    name: "Dịch",
    description: "Dịch văn bản sang ngôn ngữ đích được chọn.",
    app_type: "workflow",
    usable_for: ["tool"],
  },
];
const PROFILES = [
  { id: ID.profFake, key: "fake-1", steps: [{ provider_key: "fake-cli", model: null, on: [] }] },
];
const ME = {
  user_id: ID.padmin,
  tenant_id: ID.platform,
  tenant_key: "platform",
  username: "padmin",
  display_name: "P Admin",
  role: "platform_admin",
};

const ROUTES: [string, RegExp, Handler][] = [
  ["GET", /^\/me$/, (s) => ({ status: 200, json: { ...ME, hub_config_version: s.version } })],
  [
    "GET",
    /^\/agents$/,
    (s) => ({
      status: 200,
      json: list(
        s.agents.map((a) => listItem(s, a)),
        s,
      ),
    }),
  ],
  ["POST", /^\/agents$/, (s, _m, b) => createAgent(s, b)],
  [
    "GET",
    /^\/agents\/([^/]+)$/,
    (s, m) => {
      const a = byId(s, m[1]);
      return a ? { status: 200, json: a } : notFound();
    },
  ],
  ["PUT", /^\/agents\/([^/]+)$/, (s, m, b) => putAgent(s, m[1], b)],
  ["PATCH", /^\/agents\/([^/]+)\/enabled$/, (s, m, b) => patchEnabled(s, m[1], b)],
  ["GET", /^\/orchestrator$/, (s) => orchestrator(s)],
  ["GET", /^\/model-profiles$/, (s) => ({ status: 200, json: list(PROFILES, s) })],
  ["GET", /^\/workflows$/, (s) => ({ status: 200, json: list(WORKFLOWS, s) })],
  ["GET", /^\/(agent-types|providers|tenants)$/, (s) => ({ status: 200, json: list([], s) })],
];

function handle(s: Store, method: string, path: string, body: Body): Out {
  for (const [m, re, fn] of ROUTES) {
    const hit = method === m ? path.match(re) : null;
    if (hit) return fn(s, hit, body);
  }
  return notFound();
}

export async function login(page: Page, username = "padmin", tenant = "platform"): Promise<void> {
  await page.getByRole("textbox", { name: "Mã công ty" }).fill(tenant);
  await page.getByRole("textbox", { name: "Tên đăng nhập" }).fill(username);
  await page.getByRole("textbox", { name: "Mật khẩu" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
}

/** Mở `path` (sau basepath) với phiên sẵn và chờ khung tải xong (badge hub config). */
export async function openAuthed(page: Page, path: string): Promise<void> {
  await page.goto(`/studio${path}`);
  await expect(page.getByRole("status", { name: "Phiên bản cấu hình Hub" })).toBeVisible();
}

export const isStudioWrite = (r: Request): boolean =>
  /\/studio\/api\//.test(r.url()) && ["POST", "PUT", "PATCH", "DELETE"].includes(r.method());
