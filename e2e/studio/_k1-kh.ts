// HUB-FR-131 · HUB-FR-132 · CR-073 · mock `/studio/api/kh/connections*` + `/studio/api/secrets` (kh_api_key nền tảng) theo contract
// spec §3.1–3.2 cho e2e K1 Studio (`k1-knowledgehub.studio.ts`, test-plan K1 §4 E01–E12). Không chứa `test(...)`.
import type { Page } from "@playwright/test";

export const AT = "2026-10-13T08:00:00.000Z";
export const k = (n: number) => `e1a10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const SEC = { main: k(1), alt: k(2) };
export const CID = { main: k(41), alt: k(42) };
export const ORIGIN = "https://kh.example.com";
export const ORIGIN2 = "https://kh2.example.com";
type Item = { code: string; level: "error" | "warning"; params?: Record<string, string | number> };
export const check = (status: "ok" | "error", items: Item[], projects = ["proj-a", "proj-b"]) => ({
  status,
  checked_at: AT,
  kh_version: "v6.4",
  embedder: "BAAI/bge-m3",
  projects,
  items,
});
export type Conn = Record<string, unknown> & { id: string; name: string; version: number };
export const conn = (o: Partial<Conn> & { id: string; name: string }): Conn => ({
  base_url: ORIGIN,
  secret: { id: SEC.main, name: "kh-key-main" },
  summary_project: "proj-a",
  status: "ok",
  check: check("ok", []),
  agents_count: 1,
  version: 1,
  updated_at: AT,
  updated_by: "padmin",
  ...o,
});
export const MAIN = () => conn({ id: CID.main, name: "kh-main" });
export const ALT = () =>
  conn({
    id: CID.alt,
    name: "kh-alt",
    base_url: ORIGIN2,
    secret: { id: SEC.alt, name: "kh-key-alt" },
    summary_project: null,
    status: "unchecked",
    check: null,
    agents_count: 0,
  });

export type Kh = {
  items: Conn[];
  allowed_origins: string[];
  secrets: { id: string; name: string }[];
  calls: { method: string; path: string; body: Record<string, unknown> | undefined }[];
  once: Record<string, { status: number; body: unknown }>;
  checkResult: ReturnType<typeof check>;
};
export const err = (code: string, details?: unknown) => ({
  error: { code, message: code, ...(details ? { details } : {}) },
});

function secretItem(s: { id: string; name: string }) {
  return {
    ...s,
    kind: "kh_api_key",
    tenant: null,
    version: 1,
    used_by: [],
    created_at: AT,
    updated_at: AT,
    updated_by: "padmin",
  };
}

function write(st: Kh, id: string | null, body: Record<string, unknown>): Conn {
  const prev = st.items.find((x) => x.id === id);
  const sec = st.secrets.find((s) => s.id === body.secret_id) ?? {
    id: String(body.secret_id),
    name: "?",
  };
  const reset =
    !prev || prev.base_url !== body.base_url || (prev.secret as { id: string }).id !== sec.id;
  const row = conn({
    ...(prev ?? {}),
    id: prev?.id ?? k(100 + st.items.length),
    name: String(body.name),
    base_url: body.base_url,
    secret: sec,
    summary_project: (body.summary_project as string | null) ?? null,
    version: prev ? prev.version + 1 : 1,
    agents_count: prev?.agents_count ?? 0,
    ...(reset ? { status: "unchecked", check: null } : {}),
  });
  st.items = prev ? st.items.map((x) => (x.id === row.id ? row : x)) : [...st.items, row];
  return row;
}

/** Mock `/studio/api/kh/connections*` + `/studio/api/secrets?…` theo contract spec §3.2. */
export async function mockKh(page: Page, o: Partial<Kh> = {}): Promise<Kh> {
  const st: Kh = {
    items: [MAIN(), ALT()],
    allowed_origins: [ORIGIN, ORIGIN2],
    secrets: [
      { id: SEC.main, name: "kh-key-main" },
      { id: SEC.alt, name: "kh-key-alt" },
    ],
    calls: [],
    once: {},
    checkResult: check("ok", []),
    ...o,
  };
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: mock contract §3.2 — bảng route tuần tự
  await page.route(/\/studio\/api\/(kh\/connections|secrets)(\/|\?|$)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/studio\/api/, "");
    const body = req.postData() ? (req.postDataJSON() as Record<string, unknown>) : undefined;
    st.calls.push({ method: req.method(), path: `${path}${url.search}`, body });
    const one = st.once[`${req.method()} ${path}`];
    if (one) {
      delete st.once[`${req.method()} ${path}`];
      return route.fulfill({ status: one.status, json: one.body });
    }
    if (path.startsWith("/secrets"))
      return route.fulfill({
        status: 200,
        json: { items: st.secrets.map(secretItem), next_cursor: null },
      });
    if (path === "/kh/connections" && req.method() === "GET")
      return route.fulfill({
        status: 200,
        json: {
          items: st.items,
          next_cursor: null,
          allowed_origins: st.allowed_origins,
          timeout_ms: 5000,
        },
      });
    if (path === "/kh/connections" && req.method() === "POST")
      return route.fulfill({ status: 201, json: write(st, null, body ?? {}) });
    const m = /^\/kh\/connections\/([^/]+)(\/check)?$/.exec(path);
    const row = st.items.find((x) => x.id === m?.[1]);
    if (!m || !row) return route.fulfill({ status: 404, json: err("NOT_FOUND") });
    if (m[2]) {
      Object.assign(row, { status: st.checkResult.status, check: st.checkResult });
      return route.fulfill({ status: 200, json: st.checkResult });
    }
    if (req.method() === "PUT")
      return route.fulfill({ status: 200, json: write(st, row.id, body ?? {}) });
    if (req.method() === "DELETE") {
      st.items = st.items.filter((x) => x.id !== row.id);
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ status: 404, json: err("NOT_FOUND") });
  });
  return st;
}
