// HUB-FR-131 · HUB-BR-35 · mock `/studio/api/kh*` + secret kh_api_key theo contract spec §3.2 cho e2e K1 Studio
// (`k1-knowledgehub.studio.ts`, test-plan K1 §4 E01–E13). Không chứa `test(...)`.
import type { Page } from "@playwright/test";
import { ID } from "./_support";

export const AT = "2026-10-13T08:00:00.000Z";
export const k = (n: number) => `e1a10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const SEC = { acme: k(1), beta: k(2) };
const ACME = { id: ID.acme, key: "acme", name: "Acme Corp" };
const BETA = { id: ID.beta, key: "beta", name: "Beta Ltd" };
export const ORIGIN = "https://kh.example.com";
type Item = { code: string; level: "error" | "warning"; params?: Record<string, string | number> };
export const check = (status: "ok" | "error", items: Item[]) => ({
  status,
  checked_at: AT,
  kh_version: "v6.4",
  keyspace_dims: ["role", "step"],
  items: [...items, { code: "kh_embedder_multilingual", level: "warning" }],
});
const acmeRow = (o: Record<string, unknown> = {}) => ({
  tenant: ACME,
  ns: "acme_ns",
  secret: { id: SEC.acme, name: "kh-acme" },
  keyspace: "step",
  enabled: true,
  status: "ok",
  check: check("ok", []),
  projects: [
    { project_id: "proj-a", label: "Dự án A", read_only: false },
    { project_id: "proj-shared", label: "Dùng chung", read_only: true },
  ],
  version: 1,
  updated_at: AT,
  updated_by: "padmin",
  ...o,
});
export type Kh = {
  settings: {
    base_url: string | null;
    allowed_origins: string[];
    timeout_ms: number;
    version: number;
    updated_at: string;
  };
  tenants: Record<string, unknown>[];
  secrets: Record<string, { id: string; name: string }[]>;
  calls: { method: string; path: string; body: Record<string, unknown> | undefined }[];
  once: Record<string, { status: number; body: unknown }>;
  checkResult: unknown;
};
export const err = (code: string, details?: unknown) => ({
  error: { code, message: code, ...(details ? { details } : {}) },
});

/** Mock `/studio/api/kh*` + `/studio/api/secrets?kind=kh_api_key&tenant_id=` theo contract spec §3.2. */
export async function mockKh(page: Page, o: Partial<Kh> = {}): Promise<Kh> {
  const st: Kh = {
    settings: {
      base_url: ORIGIN,
      allowed_origins: [ORIGIN],
      timeout_ms: 5000,
      version: 3,
      updated_at: AT,
    },
    tenants: [acmeRow()],
    secrets: {
      [ID.acme]: [{ id: SEC.acme, name: "kh-acme" }],
      [ID.beta]: [{ id: SEC.beta, name: "kh-beta" }],
    },
    calls: [],
    once: {},
    checkResult: check("ok", []),
    ...o,
  };
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: mock contract §3.2 — bảng route tuần tự
  await page.route(/\/studio\/api\/(kh(\/|\?|$)|secrets\?)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/studio\/api/, "");
    const body = req.postData() ? (req.postDataJSON() as Record<string, unknown>) : undefined;
    st.calls.push({ method: req.method(), path, body });
    const one = st.once[`${req.method()} ${path}`];
    if (one) {
      delete st.once[`${req.method()} ${path}`];
      return route.fulfill({ status: one.status, json: one.body });
    }
    if (path === "/secrets") {
      const items = (st.secrets[url.searchParams.get("tenant_id") ?? ""] ?? []).map((s) => ({
        ...s,
        kind: "kh_api_key",
        tenant: url.searchParams.get("tenant_id") === ID.acme ? ACME : BETA,
        version: 1,
        used_by: [],
        created_at: AT,
        updated_at: AT,
        updated_by: "padmin",
      }));
      return route.fulfill({ status: 200, json: { items, next_cursor: null } });
    }
    if (path === "/kh/settings" && req.method() === "GET")
      return route.fulfill({ status: 200, json: st.settings });
    if (path === "/kh/settings" && req.method() === "PUT") {
      st.settings = {
        ...st.settings,
        base_url: (body?.base_url as string) ?? null,
        version: st.settings.version + 1,
      };
      return route.fulfill({ status: 200, json: st.settings });
    }
    if (path === "/kh/tenants" && req.method() === "GET")
      return route.fulfill({ status: 200, json: { items: st.tenants, next_cursor: null } });
    const m = /^\/kh\/tenants\/([^/]+)(\/check)?$/.exec(path);
    if (m?.[2]) return route.fulfill({ status: 200, json: st.checkResult });
    if (m && req.method() === "PUT") {
      const t = m[1] === ID.acme ? ACME : BETA;
      const row = acmeRow({
        tenant: t,
        ns: body?.ns,
        projects: body?.projects,
        status: "unchecked",
        check: null,
        enabled: false,
      });
      st.tenants.push(row);
      return route.fulfill({ status: 201, json: row });
    }
    if (m && req.method() === "DELETE") {
      st.tenants = st.tenants.filter((x) => (x.tenant as { id: string }).id !== m[1]);
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ status: 404, json: err("NOT_FOUND") });
  });
  return st;
}
