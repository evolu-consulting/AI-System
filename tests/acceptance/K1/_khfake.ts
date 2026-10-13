// HUB-FR-131 · HUB-FR-134 · HUB-FR-137 · HUB-BR-35 · KnowledgeHub GIẢ của qc (test-plan K1 §2): Bun.serve cổng 0, trạng thái
// trong bộ nhớ, hình API theo hợp đồng KH v6.4 (`KnowledgeHub/docs/integration/api-contract.md` + `auth-and-tenancy.md`):
// `/health`, `/version`, `POST /v1/token` (JSON hoặc form; client `kh-ns-<ns>`), `/v1/me`, `/v1/capabilities`,
// `/v1/{ns}/manifest`, `/v1/{ns}/context/step`, `/v1/{ns}/worklog` (idempotency: replay ⇒ `Idempotent-Replay: true`).
// ĐỘC LẬP với mock sản phẩm `tools/mocks/src/kh` (plan §7, backend-lead T5b) — test khoá không phụ thuộc code chưa có.
// Ghi mọi lời gọi (`calls`, kèm token đã dùng để kiểm "token mới khi 401") và mọi token đã cấp (`tokens`, tiền tố `khfake_`
// để quét "không lộ"). Không chứa `it(...)`.

// biome-ignore lint/suspicious/noExplicitAny: thân JSON tuỳ ý của KH
type Json = any;

export type Scenario =
  | "ok"
  | "token_expired_once"
  | "token_expired_always"
  | "ns_not_active"
  | "ns_suspended"
  | "embedder_unavailable"
  | "forbidden"
  | "quota"
  | "timeout"
  | "server_error"
  | "invalid";

export type NsCfg = {
  clientId: string;
  clientSecret: string;
  /** kịch bản cho lời gọi dữ liệu (`context/step`, `worklog`); `ns_not_active`/`ns_suspended` áp cả `me`/`manifest`. */
  scenario: Scenario;
  /** `manifest.settings.include_people_lanes`; `null` = vắng (KH: bật). */
  peopleLanes: boolean | null;
  /** `manifest.settings.retrieval.include_people_lanes` (ghi đè) — `undefined` = vắng. */
  retrievalLanes?: boolean;
  /** `me.projects` (project gắn với client). */
  projects: string[];
  keyspaces: { keyspace: string; dims: string[] }[];
  /** 0 = chưa có manifest. */
  manifestRev: number;
  /** `me.kind` khi có token. */
  kind: string;
  /** `me.ns` (mặc định = ns của token). */
  meNs?: string;
  packText: string;
};

export type Global = {
  version: string;
  /** `off` ⇒ mọi route nhận cả khi không token; `/v1/me` không token ⇒ 200 `kind=local`. */
  auth: "on" | "off";
  health: number;
  capabilities: Json;
  /** ghi đè status của `POST /v1/token` (vd 500); null = bình thường. */
  tokenStatus: number | null;
  ttlS: number;
  /** độ trễ (ms) của kịch bản `timeout`. */
  delayMs: number;
};

export type KhCall = {
  ns: string | null;
  method: string;
  path: string;
  /** token Bearer đã gửi (null = không header). */
  token: string | null;
  idem: string | null;
  xkh: Record<string, string>;
  body: Json;
  status: number;
};

export type WorklogRow = {
  ns: string;
  project: string;
  subject: string;
  text: string;
  idem: string | null;
  id: string;
};

export const DEFAULT_CAPS = {
  kh_version: "v6.4",
  api_versions: ["v1"],
  capabilities: [
    { name: "retrieval", version: "1.0.0", status: "beta" },
    { name: "events", version: "1.0.0", status: "beta" },
  ],
};

const defaultGlobal = (): Global => ({
  version: "v6.4",
  auth: "on",
  health: 200,
  capabilities: structuredClone(DEFAULT_CAPS),
  tokenStatus: null,
  ttlS: 900,
  delayMs: 2_500,
});

export const khClientId = (ns: string) => `kh-ns-${ns}`;

export function nsDefaults(ns: string, secret: string): NsCfg {
  return {
    clientId: khClientId(ns),
    clientSecret: secret,
    scenario: "ok",
    peopleLanes: false,
    projects: [],
    keyspaces: [{ keyspace: "step", dims: ["role", "step"] }],
    manifestRev: 1,
    kind: "client",
    packText: `PACK-${ns}: quy ước đặt tên hoá đơn HD-xx.`,
  };
}

export type KhFake = {
  base: string;
  origin: string;
  g: Global;
  ns: Map<string, NsCfg>;
  calls: KhCall[];
  tokens: string[];
  worklog: WorklogRow[];
  /** sửa cấu hình ns (tạo nếu chưa có — cần `clientSecret` khi tạo). */
  set: (ns: string, patch: Partial<NsCfg>) => void;
  /** lời gọi tới ns (lọc path chứa `part` nếu có). */
  callsOf: (ns: string, part?: string) => KhCall[];
  reset: () => void;
  close: () => Promise<void>;
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

async function readBody(req: Request): Promise<Json> {
  const t = await req.text();
  if (!t) return null;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded"))
    return Object.fromEntries(new URLSearchParams(t));
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

/** Lỗi theo kịch bản cho lời gọi dữ liệu; null = đi tiếp. */
function scenarioError(s: Scenario): Response | null {
  if (s === "ns_not_active") return json(404, { error: "ns_not_active" });
  if (s === "ns_suspended") return json(423, { error: "ns_suspended" });
  if (s === "embedder_unavailable")
    return json(503, { error: "embedder_unavailable", detail: "down" });
  if (s === "forbidden") return json(403, { error: "forbidden", detail: "project not granted" });
  if (s === "quota") return json(429, { error: "quota" }, { "retry-after": "1" });
  if (s === "server_error") return json(500, { detail: "boom" });
  if (s === "invalid") return json(422, { error: "invalid", detail: "bad key" });
  return null;
}

export function startKhFake(): KhFake {
  let g = defaultGlobal();
  const ns = new Map<string, NsCfg>();
  const calls: KhCall[] = [];
  const tokens: string[] = [];
  const live = new Map<string, { ns: string; exp: number }>();
  const worklog: WorklogRow[] = [];
  const idemSeen = new Map<string, { hash: string; id: string }>();
  const expiredOnce = new Set<string>();
  let n = 0;

  function issue(req: Json): Response {
    if (g.tokenStatus !== null) return json(g.tokenStatus, { error: "server_error" });
    const cfg = [...ns.entries()].find(([, c]) => c.clientId === req?.client_id);
    if (
      !cfg ||
      cfg[1].clientSecret !== req?.client_secret ||
      req?.grant_type !== "client_credentials"
    )
      return json(401, { error: "unauthorized", detail: "invalid client" });
    n += 1;
    const t = `khfake_${cfg[0]}_${n}_${Math.random().toString(36).slice(2, 10)}`;
    tokens.push(t);
    const exp = Math.floor(Date.now() / 1000) + g.ttlS;
    live.set(t, { ns: cfg[0], exp });
    return json(200, {
      access_token: t,
      token_type: "Bearer",
      expires_in: g.ttlS,
      expires_at: exp,
    });
  }

  /** null = hợp lệ (hoặc auth off); Response = 401. */
  function authErr(token: string | null): Response | null {
    if (g.auth === "off") return null;
    if (!token) return json(401, { detail: "sign-in required" });
    const t = live.get(token);
    if (!t || t.exp * 1000 <= Date.now()) return json(401, { detail: "token expired" });
    return null;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: KH giả — một nhánh mỗi kịch bản (đọc tuần tự)
  async function data(
    p: string,
    token: string | null,
    req: Request,
    body: Json,
  ): Promise<Response> {
    const m = /^\/v1\/([^/]+)\/(manifest|context\/step|worklog)$/.exec(p);
    if (!m) return new Response("not found", { status: 404 });
    const [, nsName = "", what] = m;
    const cfg = ns.get(nsName);
    const a = authErr(token);
    if (a) return a;
    const owner = token ? live.get(token)?.ns : undefined;
    if (g.auth === "on" && owner !== nsName)
      return json(403, { error: "forbidden", detail: "other namespace" });
    if (!cfg) return json(404, { error: "ns_not_active" });
    if (what === "manifest") {
      if (cfg.scenario === "ns_not_active" || cfg.scenario === "ns_suspended")
        return scenarioError(cfg.scenario) as Response;
      const settings: Json = {};
      if (cfg.peopleLanes !== null) settings.include_people_lanes = cfg.peopleLanes;
      if (cfg.retrievalLanes !== undefined)
        settings.retrieval = { include_people_lanes: cfg.retrievalLanes };
      return json(200, {
        ns: nsName,
        manifest_rev: cfg.manifestRev,
        manifest: cfg.manifestRev === 0 ? {} : { keyspaces: cfg.keyspaces, settings },
      });
    }
    if (cfg.scenario === "token_expired_always") return json(401, { detail: "token expired" });
    if (cfg.scenario === "token_expired_once" && token && !expiredOnce.has(nsName)) {
      expiredOnce.add(nsName);
      live.delete(token);
      return json(401, { detail: "token expired" });
    }
    if (cfg.scenario === "timeout") await new Promise((r) => setTimeout(r, g.delayMs));
    const e = scenarioError(cfg.scenario);
    if (e) return e;
    if (what === "context/step") {
      const text = String(cfg.packText);
      return json(200, {
        serve_id: `sv_${nsName}_${calls.length}`,
        project: body?.project,
        keyspace: body?.keyspace,
        key: body?.key,
        pack_text: text,
        used_chars: text.length,
        cut_at_budget: false,
        budget_chars: body?.budget_chars,
        people_lanes: cfg.peopleLanes !== false,
      });
    }
    const idem = req.headers.get("idempotency-key");
    const hash = JSON.stringify([body?.project, body?.subject, body?.text]);
    if (idem && idemSeen.has(`${nsName}:${idem}`)) {
      const s = idemSeen.get(`${nsName}:${idem}`) as { hash: string; id: string };
      if (s.hash !== hash) return json(422, { error: "idempotency_mismatch" });
      return json(
        201,
        { id: s.id, project: body?.project, subject: body?.subject },
        {
          "idempotent-replay": "true",
        },
      );
    }
    const id = `wl_${worklog.length + 1}`;
    if (idem) idemSeen.set(`${nsName}:${idem}`, { hash, id });
    worklog.push({
      ns: nsName,
      project: body?.project,
      subject: body?.subject,
      text: body?.text,
      idem,
      id,
    });
    return json(201, { id, project: body?.project, subject: body?.subject, ts: Date.now() });
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: KH giả — bảng route tuần tự
  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    const body = req.method === "GET" ? null : await readBody(req);
    const auth = req.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (p === "/health") return json(g.health, { status: g.health === 200 ? "ok" : "down" });
    if (p === "/version") return json(200, { version: g.version });
    if (p === "/v1/token" && req.method === "POST") return issue(body);
    if (p === "/v1/capabilities") return authErr(token) ?? json(200, g.capabilities);
    if (p === "/v1/me") {
      if (!token) {
        return g.auth === "off"
          ? json(200, { kind: "local", principal: "local", role: "admin" })
          : json(401, { detail: "sign-in required" });
      }
      const a = authErr(token);
      if (a) return a;
      const tn = live.get(token)?.ns ?? "";
      const cfg = ns.get(tn);
      if (cfg?.scenario === "ns_not_active") return json(404, { error: "ns_not_active" });
      return json(200, {
        kind: cfg?.kind ?? "client",
        ns: cfg?.meNs ?? tn,
        principal: cfg?.clientId,
        role: "service",
        projects: cfg?.projects ?? [],
      });
    }
    return data(p, token, req, body);
  }

  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const res = await handle(req.clone());
      const m = /^\/v1\/([^/]+)\//.exec(url.pathname);
      const auth = req.headers.get("authorization");
      const xkh: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        if (k.startsWith("x-kh-")) xkh[k] = v;
      });
      let body: Json = null;
      if (req.method !== "GET") body = await readBody(req);
      calls.push({
        ns: m && !["token", "me", "capabilities"].includes(m[1] ?? "") ? (m[1] ?? null) : null,
        method: req.method,
        path: url.pathname,
        token: auth?.startsWith("Bearer ") ? auth.slice(7) : null,
        idem: req.headers.get("idempotency-key"),
        xkh,
        body,
        status: res.status,
      });
      return res;
    },
  });
  const origin = `http://localhost:${server.port}`;
  return {
    base: origin,
    origin,
    get g() {
      return g;
    },
    ns,
    calls,
    tokens,
    worklog,
    set: (name, patch) => {
      const cur = ns.get(name) ?? nsDefaults(name, patch.clientSecret ?? "");
      ns.set(name, { ...cur, ...patch });
    },
    callsOf: (name, part) =>
      calls.filter((c) => c.path.startsWith(`/v1/${name}/`) && (!part || c.path.includes(part))),
    reset: () => {
      g = defaultGlobal();
      calls.length = 0;
      worklog.length = 0;
      idemSeen.clear();
      expiredOnce.clear();
    },
    close: async () => {
      await server.stop(true);
    },
  };
}

/** Origin chắc chắn không nghe (dựng rồi đóng ngay) — kịch bản `unreachable`. */
export async function deadOrigin(): Promise<string> {
  const s = Bun.serve({ port: 0, fetch: () => new Response("x") });
  const o = `http://localhost:${s.port}`;
  await s.stop(true);
  return o;
}
