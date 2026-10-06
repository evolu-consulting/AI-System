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
export const TOTP_CODE = "123456";
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

type OrchSettings = {
  agent_id: string;
  max_steps: number;
  token_budget: number;
  history_n: number;
  on_no_match: "answer" | "ask";
  version: number;
};
export type Store = {
  version: number;
  agents: Agent[];
  entitled: Record<string, number>;
  /** Orchestrator mặc định + bản theo tenant (plan §2/§3 `OrchestratorListSchema`). */
  orchDefault: OrchSettings;
  orchTenants: (OrchSettings & { tenant_id: string })[];
  calls: { method: string; path: string; body: unknown }[];
};
export function seedStore(): Store {
  const st: Store = {
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
    orchDefault: {
      agent_id: ID.orch,
      max_steps: 5,
      token_budget: 200000,
      history_n: 10,
      on_no_match: "answer",
      version: 1,
    },
    // `beta` đã có bản riêng (nên không được chọn trong Sheet "Thêm cho tenant"); `acme` chưa có.
    orchTenants: [
      {
        tenant_id: ID.beta,
        agent_id: ID.helper,
        max_steps: 3,
        token_budget: 50000,
        history_n: 4,
        on_no_match: "ask",
        version: 1,
      },
    ],
    calls: [],
  };
  syncOrchestratorOf(st);
  return st;
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
  /** Tài khoản bật 2FA: `/auth/login` trả `totp_required`; `/auth/totp/verify` chỉ nhận `TOTP_CODE`. */
  totp?: boolean;
  /** Ghi đè phản hồi một lần cho `METHOD path` (vd 409 xung đột). */
  once?: Record<string, { status: number; body: unknown }>;
};

type Sess = { loggedIn: boolean };
const TOTP_TOKEN = "eyJ.totp.tok";
function authLogin(o: MockOpts, sess: Sess, req: Request, grant: () => unknown): Out {
  const b = req.postDataJSON() as { password?: string };
  if (b?.password !== PASSWORD)
    return { status: 401, json: err("INVALID_CREDENTIALS", "Invalid credentials") };
  if (o.totp)
    return {
      status: 200,
      json: { status: "totp_required", totp_token: TOTP_TOKEN, expires_in: 300 },
    };
  sess.loggedIn = true;
  return { status: 200, json: grant() };
}
function authTotp(sess: Sess, req: Request, grant: () => unknown): Out {
  const b = req.postDataJSON() as { totp_token?: string; code?: string };
  if (b?.totp_token !== TOTP_TOKEN || b?.code !== TOTP_CODE)
    return { status: 401, json: err("INVALID_TOTP_CODE", "Invalid code") };
  sess.loggedIn = true;
  return { status: 200, json: grant() };
}

/** Cài mock `/auth/*` + `/studio/api/*`; trả kho để ca đọc/khẳng định. */
export async function mockStudio(page: Page, o: MockOpts = {}): Promise<Store> {
  const s = o.store ?? seedStore();
  const role = o.role ?? "platform_admin";
  const once = { ...(o.once ?? {}) };
  const loggedIn = !!o.session;
  const grant = () => ({
    status: "authenticated",
    access_token: `tok-${role}`,
    token_type: "Bearer",
    expires_in: 900,
    user: authUser(role),
  });

  const sess = { loggedIn };
  const authFulfill = (path: string, req: Request): Out => {
    if (path.endsWith("/auth/login")) return authLogin(o, sess, req, grant);
    if (path.endsWith("/auth/totp/verify")) return authTotp(sess, req, grant);
    if (path.endsWith("/auth/refresh"))
      return sess.loggedIn
        ? { status: 200, json: grant() }
        : { status: 401, json: err("AUTH_EXPIRED", "Expired") };
    if (path.endsWith("/auth/logout")) {
      sess.loggedIn = false;
      return { status: 204, body: "" };
    }
    return { status: 404, json: err("NOT_FOUND", "Not found") };
  };
  await page.route(/\/auth\//, async (route) => {
    const req = route.request();
    return route.fulfill(authFulfill(new URL(req.url()).pathname, req));
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
const TENANTS = [
  { id: ID.acme, key: "acme", name: "Acme Corp", active: true },
  { id: ID.beta, key: "beta", name: "Beta Ltd", active: true },
];
function orchView(s: Store, o: OrchSettings, tenantId: string | null) {
  const a = byId(s, o.agent_id) as Agent;
  const t = TENANTS.find((x) => x.id === tenantId);
  return {
    id: tenantId ? 100 + s.orchTenants.findIndex((x) => x.tenant_id === tenantId) : 1,
    tenant: t ? { id: t.id, key: t.key, name: t.name } : null,
    agent: { id: a.id, key: a.key, name: a.name, runtime: a.runtime, enabled: a.enabled },
    max_steps: o.max_steps,
    token_budget: o.token_budget,
    history_n: o.history_n,
    on_no_match: o.on_no_match,
    version: o.version,
    updated_by: null,
    updated_at: NOW,
    warnings: a.runtime === "agentic-cli" ? ["agentic_cli_slow"] : [],
  };
}
function syncOrchestratorOf(s: Store): void {
  for (const a of s.agents)
    a.orchestrator_of = {
      default: a.id === s.orchDefault.agent_id,
      tenant_ids: s.orchTenants.filter((t) => t.agent_id === a.id).map((t) => t.tenant_id),
    };
}
function orchestrator(s: Store): Out {
  return {
    status: 200,
    json: {
      default: orchView(s, s.orchDefault, null),
      tenants: s.orchTenants.map((t) => orchView(s, t, t.tenant_id)),
      hub_config_version: s.version,
    },
  };
}
function putOrchDefault(s: Store, body: Body): Out {
  if (body?.version !== s.orchDefault.version)
    return { status: 409, json: err("VERSION_CONFLICT", "Version conflict") };
  Object.assign(s.orchDefault, body, { version: s.orchDefault.version + 1 });
  s.version += 1;
  syncOrchestratorOf(s);
  return {
    status: 200,
    json: { orchestrator: orchView(s, s.orchDefault, null), hub_config_version: s.version },
  };
}
function postOrchTenant(s: Store, body: Body): Out {
  const tid = String(body?.tenant_id);
  if (s.orchTenants.some((t) => t.tenant_id === tid))
    return { status: 409, json: err("ORCHESTRATOR_EXISTS", "Orchestrator exists") };
  const { tenant_id: _t, ...rest } = body as Record<string, unknown>;
  s.orchTenants.push({ ...(rest as unknown as OrchSettings), tenant_id: tid, version: 1 });
  s.version += 1;
  syncOrchestratorOf(s);
  return {
    status: 201,
    json: {
      orchestrator: orchView(s, s.orchTenants[s.orchTenants.length - 1] as OrchSettings, tid),
      hub_config_version: s.version,
    },
  };
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
  ["PUT", /^\/orchestrator\/default$/, (s, _m, b) => putOrchDefault(s, b)],
  ["POST", /^\/orchestrator\/tenants$/, (s, _m, b) => postOrchTenant(s, b)],
  [
    "GET",
    /^\/tenants$/,
    (s) => ({
      status: 200,
      json: list(
        TENANTS.map((t) => ({
          ...t,
          has_orchestrator: s.orchTenants.some((o) => o.tenant_id === t.id),
        })),
        s,
      ),
    }),
  ],
  ["GET", /^\/model-profiles$/, (s) => ({ status: 200, json: list(PROFILES, s) })],
  ["GET", /^\/workflows$/, (s) => ({ status: 200, json: list(WORKFLOWS, s) })],
  ["GET", /^\/(agent-types|providers)$/, (s) => ({ status: 200, json: list([], s) })],
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
