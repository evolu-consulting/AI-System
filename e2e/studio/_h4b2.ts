// HUB-FR-66 · HUB-FR-67 · HUB-FR-78 · e2e H4b-2: kho giả cho `/studio/api/{providers,model-profiles,secrets,
// agent-entitlements}` theo contract spec H4b2 §3 (không import contract để chạy được trước B1). Đăng ký SAU `mockStudio`
// nên được ưu tiên. `once` ghi đè một lần theo "METHOD path"; `hold` giữ phản hồi tới khi ca gọi `release()` (kiểm trạng
// thái "đang chạy"). Không chứa `test(...)`.
import { expect, type Locator, type Page } from "@playwright/test";
import { ID, mockStudio, openAuthed } from "./_support";

const p = (n: number) => `e4b20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const AT = "2026-10-13T08:00:00.000Z";
export const PV = {
  claudeSub: p(1),
  codexSub: p(2),
  anthApi: p(3),
  openaiApi: p(4),
  fakeApi: p(5),
  geminiSub: p(6),
} as const;
export const PF = { coder: p(11), smart: p(12), fake1: p(13) } as const;
export const SECRET = { anthProd: p(21), openaiMain: p(22) } as const;

type State = { status: string; cooldown_until: string | null; utilization: number | null };
export type Prov = {
  id: string;
  key: string;
  kind: "api" | "subscription";
  vendor: string;
  base_url: string | null;
  has_secret: boolean;
  max_concurrency: number;
  enabled: boolean;
  dev_only: boolean;
  state: State | null;
  version: number;
  slots_in_use: number;
  secret: { id: string; name: string } | null;
  last_error: string | null;
};
const prov = (id: string, key: string, o: Partial<Prov>): Prov => ({
  id,
  key,
  kind: "subscription",
  vendor: "anthropic",
  base_url: null,
  has_secret: false,
  max_concurrency: 1,
  enabled: true,
  dev_only: false,
  state: null,
  version: 1,
  slots_in_use: 0,
  secret: null,
  last_error: null,
  ...o,
});
const ok = (s = "ok", cooldown: string | null = null): State => ({
  status: s,
  cooldown_until: cooldown,
  utilization: null,
});
export type Step = { provider_key: string; model: string | null; on: string[] };
export type Prof = {
  id: string;
  key: string;
  steps: Step[];
  version: number;
  active_step: number | null;
  all_subscription: boolean;
  agent_count: number;
};
const ALL = ["error", "quota", "timeout"];
export function seedModels(): { providers: Prov[]; profiles: Prof[] } {
  const in42 = new Date(Date.now() + 42 * 60_000 + 20_000).toISOString();
  return {
    providers: [
      prov(PV.claudeSub, "claude-sub", { max_concurrency: 2, slots_in_use: 1, state: ok() }),
      prov(PV.codexSub, "codex-sub", {
        vendor: "openai",
        state: ok("logged_out"),
        last_error: "Not logged in",
      }),
      prov(PV.geminiSub, "gemini-sub", { vendor: "google", state: ok("cooldown", in42) }),
      prov(PV.anthApi, "anthropic-api", {
        kind: "api",
        has_secret: true,
        secret: { id: SECRET.anthProd, name: "anthropic-prod" },
      }),
      prov(PV.openaiApi, "openai-api", {
        kind: "api",
        vendor: "openai",
        has_secret: true,
        secret: { id: SECRET.openaiMain, name: "openai-main" },
      }),
      prov(PV.fakeApi, "fake-api", {
        kind: "api",
        vendor: "fake",
        dev_only: true,
        has_secret: true,
        secret: { id: SECRET.anthProd, name: "anthropic-prod" },
      }),
    ],
    profiles: [
      {
        id: PF.coder,
        key: "coder",
        steps: [
          { provider_key: "gemini-sub", model: "gemini-pro", on: ALL },
          { provider_key: "claude-sub", model: "claude-sonnet", on: ALL },
          { provider_key: "anthropic-api", model: "claude-sonnet", on: [] },
        ],
        version: 1,
        active_step: 1,
        all_subscription: false,
        agent_count: 2,
      },
      {
        id: PF.smart,
        key: "smart",
        steps: [
          { provider_key: "codex-sub", model: "gpt-5", on: [] },
          { provider_key: "openai-api", model: "gpt-5", on: [] },
        ],
        version: 1,
        active_step: null,
        all_subscription: false,
        agent_count: 1,
      },
      {
        id: PF.fake1,
        key: "fake-1",
        steps: [{ provider_key: "claude-sub", model: "claude-haiku", on: [] }],
        version: 1,
        active_step: 0,
        all_subscription: true,
        agent_count: 3,
      },
    ],
  };
}

export type Call = {
  method: string;
  path: string;
  query: string;
  body: Record<string, unknown> | undefined;
};
export type Kho = {
  providers: Prov[];
  profiles: Prof[];
  /** ô entitlement `agent|tenant` ⇒ số grant (vắng = chưa cấp). */
  cells: Record<string, { grants: { group: number; user: number; tenant: number } }>;
  calls: Call[];
  once: Record<string, { status: number; body: unknown }>;
  holds: Record<string, Promise<void>>;
  /** Giữ phản hồi của "METHOD path" tới khi `release(key)` (kiểm trạng thái đang chạy). */
  hold: (key: string) => void;
  release: (key: string) => void;
};
const err = (code: string, details?: unknown) => ({
  error: { code, message: code, ...(details ? { details } : {}) },
});
const item = (x: Prov) => {
  const { secret: _s, last_error: _l, ...rest } = x;
  return rest;
};
const detail = (x: Prov, k: Kho) => ({
  ...item(x),
  readonly: false,
  updated_at: AT,
  state: x.state && {
    ...x.state,
    last_probe_at: AT,
    last_ok_at: null,
    last_error: x.last_error,
  },
  secret: x.secret,
  used_by_profiles: k.profiles
    .filter((q) => q.steps.some((s) => s.provider_key === x.key))
    .map((q) => ({ id: q.id, key: q.key })),
});
const SECRETS = [
  { id: SECRET.anthProd, name: "anthropic-prod" },
  { id: SECRET.openaiMain, name: "openai-main" },
].map((s) => ({
  ...s,
  kind: "provider_api_key",
  tenant: null,
  version: 1,
  used_by: [],
  created_at: AT,
  updated_at: AT,
  updated_by: "padmin",
}));
type Out = { status: number; json?: unknown; body?: string };

function providers(k: Kho, m: string, seg: string[], b: Record<string, unknown> | undefined): Out {
  const [id, sub] = seg;
  if (!id && m === "GET")
    return {
      status: 200,
      json: {
        items: k.providers.map(item),
        total: k.providers.length,
        truncated: false,
        hub_config_version: 18,
      },
    };
  if (!id && m === "POST") {
    const n = prov(p(100 + k.providers.length), String(b?.key), {
      kind: b?.kind as Prov["kind"],
      vendor: String(b?.vendor),
      base_url: (b?.base_url as string) ?? null,
      max_concurrency: Number(b?.max_concurrency ?? 1),
      has_secret: !!b?.secret_id,
      secret: b?.secret_id ? { id: String(b.secret_id), name: "openai-main" } : null,
    });
    k.providers.push(n);
    return { status: 201, json: detail(n, k) };
  }
  const x = k.providers.find((q) => q.id === id);
  if (!x) return { status: 404, json: err("NOT_FOUND") };
  if (sub === "check")
    return {
      status: 200,
      json: {
        status: "ok",
        error_code: null,
        http_status: 200,
        message: null,
        latency_ms: 120,
        checked_at: AT,
      },
    };
  if (m === "GET") return { status: 200, json: detail(x, k) };
  if (m === "DELETE") {
    k.providers = k.providers.filter((q) => q !== x);
    return { status: 204, body: "" };
  }
  Object.assign(
    x,
    sub === "enabled"
      ? { enabled: b?.enabled }
      : { max_concurrency: b?.max_concurrency, base_url: b?.base_url ?? null, enabled: b?.enabled },
  );
  x.version += 1;
  return { status: 200, json: detail(x, k) };
}
function profiles(k: Kho, m: string, seg: string[], b: Record<string, unknown> | undefined): Out {
  const [id] = seg;
  const full = (q: Prof) => ({ ...q, updated_at: AT, used_by_agents: [] });
  if (!id && m === "GET")
    return {
      status: 200,
      json: {
        items: k.profiles,
        total: k.profiles.length,
        truncated: false,
        hub_config_version: 18,
      },
    };
  if (!id && m === "POST") {
    const n: Prof = {
      id: p(200 + k.profiles.length),
      key: String(b?.key),
      steps: b?.steps as Step[],
      version: 1,
      active_step: 0,
      all_subscription: true,
      agent_count: 0,
    };
    k.profiles.push(n);
    return { status: 201, json: full(n) };
  }
  const q = k.profiles.find((r) => r.id === id);
  if (!q) return { status: 404, json: err("NOT_FOUND") };
  if (m === "GET") return { status: 200, json: full(q) };
  if (m === "DELETE") {
    k.profiles = k.profiles.filter((r) => r !== q);
    return { status: 204, body: "" };
  }
  q.steps = b?.steps as Step[];
  q.version += 1;
  return { status: 200, json: full(q) };
}

type EntFn = (k: Kho, m: string, seg: string[]) => Out;
function dispatch(
  k: Kho,
  m: string,
  path: string,
  body: Record<string, unknown> | undefined,
  ent?: EntFn,
): Out {
  const [, group, ...seg] = path.split("/");
  if (group === "providers") return providers(k, m, seg, body);
  if (group === "model-profiles") return profiles(k, m, seg, body);
  if (group === "secrets") return { status: 200, json: { items: SECRETS, next_cursor: null } };
  return ent ? ent(k, m, seg) : { status: 404, json: err("NOT_FOUND") };
}

/** Cài mock Models/Quyền agent sau `mockStudio`; trả kho để ca khẳng định. */
export async function mockH4b2(
  page: Page,
  o: { once?: Kho["once"]; entitlements?: (k: Kho, m: string, seg: string[]) => Out } = {},
): Promise<Kho> {
  const s = seedModels();
  const gates: Record<string, () => void> = {};
  const k: Kho = {
    ...s,
    cells: {},
    calls: [],
    once: { ...(o.once ?? {}) },
    holds: {},
    hold: (key) => {
      k.holds[key] = new Promise<void>((r) => {
        gates[key] = r;
      });
    },
    release: (key) => gates[key]?.(),
  };
  await page.route(
    /\/studio\/api\/(providers|model-profiles|secrets|agent-entitlements)(\/|\?|$)/,
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname.replace(/^.*\/studio\/api/, "");
      const m = req.method();
      const body = req.postData() ? (req.postDataJSON() as Record<string, unknown>) : undefined;
      k.calls.push({ method: m, path, query: url.search, body });
      const key = `${m} ${path}`;
      if (k.holds[key]) await k.holds[key];
      const one = k.once[key];
      if (one) {
        delete k.once[key];
        return route.fulfill({ status: one.status, json: one.body });
      }
      const out = dispatch(k, m, path, body, o.entitlements);
      return route.fulfill(
        out.json !== undefined
          ? { status: out.status, json: out.json }
          : { status: out.status, body: out.body ?? "" },
      );
    },
  );
  return k;
}

export async function openModels(
  page: Page,
  o: Parameters<typeof mockH4b2>[1] = {},
  path = "/models",
) {
  await mockStudio(page, { session: true });
  const k = await mockH4b2(page, o);
  await openAuthed(page, path);
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();
  return k;
}
export const writes = (k: Kho) => k.calls.filter((c) => c.method !== "GET");
export const toast = (page: Page) => page.getByRole("region", { name: "Notifications" });
/** Chọn `label` trong combobox (native `<select>` hoặc Radix Select). */
export async function choose(page: Page, box: Locator, label: string): Promise<void> {
  const tag = await box.evaluate((e) => e.tagName.toLowerCase());
  if (tag === "select") {
    await box.selectOption({ label });
    return;
  }
  await box.click();
  await page.getByRole("option", { name: label, exact: true }).click();
}
export { ID };
