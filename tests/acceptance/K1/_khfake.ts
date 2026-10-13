// HUB-FR-131 · HUB-FR-132 · HUB-FR-133 · HUB-FR-134 · CR-073 · KnowledgeHub GIẢ của qc (test-plan K1 §2): Bun.serve cổng 0, trạng
// thái trong bộ nhớ, hình API theo KH v6.4 chế độ khoá chung (spec §3.0; đối chiếu `ai-sdlc-rowan/POC/KnowledgeHub/main.py` +
// `app/schemas.py` + `app/projects.py`):
//   gate `X-KH-Key` | `Authorization: Bearer` = khoá (trừ `/health`) ⇒ sai/thiếu `401 {"detail":"missing or invalid API key"}`;
//   `GET /health` ⇒ `{status:"ok", model}` · `GET /version` ⇒ `{version, source, model}` ·
//   `GET /projects` ⇒ `{version, projects: {<id>: {...}}, store: {}}` (project khoá thấy) ·
//   `POST /vector/query {text, project, k, max_chars}` ⇒ `{hits: [{vector_id, score, source_text, summary, truncated}]}`;
//     project không thấy ⇒ `403 {detail}` ·
//   `POST /vector/add {id, text, scope, metadata}` ⇒ upsert theo `id` ⇒ `{status:"ok", vector_id, dimension}`.
// ĐỘC LẬP mock sản phẩm `tools/mocks/src/kh` (plan §7) — test khoá không phụ thuộc code chưa có. Ghi mọi lời gọi (`calls`:
// có khoá hay không, khoá đúng hay không — KHÔNG lưu giá trị khoá), mọi vector đã ghi (`vectors`). Không chứa `it(...)`.

// biome-ignore lint/suspicious/noExplicitAny: thân JSON tuỳ ý của KH
type Json = any;

/** Kịch bản cho route dữ liệu (`/vector/*`); `/projects` theo `projectsStatus`. */
export type Scenario =
  | "ok"
  | "server_error"
  | "server_error_once"
  | "rate_limited"
  | "not_found"
  | "forbidden"
  | "timeout"
  | "bad_body";

export type KhHit = { score: number; source_text: string };
export type KhState = {
  key: string;
  /** false = KH tắt xác thực (mọi route nhận khi không khoá). */
  auth: boolean;
  /** true = KH ở chế độ đăng nhập (SSO): khoá tĩnh luôn bị 401 (Q27). */
  sso: boolean;
  version: string;
  model: string;
  healthStatus: number;
  /** status của `/projects` (200 = bình thường). */
  projectsStatus: number;
  projects: string[];
  hits: Record<string, KhHit[]>;
  scenario: Scenario;
  delayMs: number;
  /** true ⇒ MỌI route (kể cả `/health`) trễ `delayMs` (cho `kh_timeout`). */
  slow: boolean;
};
export type KhCall = {
  method: string;
  path: string;
  /** có gửi khoá (header `X-KH-Key` hoặc Bearer). */
  sentKey: boolean;
  /** header dùng: `x-kh-key` | `bearer` | null. */
  via: "x-kh-key" | "bearer" | null;
  keyOk: boolean;
  body: Json;
  status: number;
};
export type KhVector = { id: string; text: string; scope: unknown; metadata: Json; writes: number };

export type KhFake = {
  base: string;
  origin: string;
  state: KhState;
  calls: KhCall[];
  vectors: Map<string, KhVector>;
  set: (patch: Partial<KhState>) => void;
  reset: () => void;
  /** lời gọi tới `path` (không tính `/health`). */
  callsTo: (path: string) => KhCall[];
  close: () => Promise<void>;
};

export const DEFAULT_MODEL = "BAAI/bge-m3";
const fresh = (key: string, projects: string[]): KhState => ({
  key,
  auth: true,
  sso: false,
  version: "v6.4",
  model: DEFAULT_MODEL,
  healthStatus: 200,
  projectsStatus: 200,
  projects,
  hits: Object.fromEntries(
    projects.map((p) => [p, [{ score: 0.8, source_text: `HIT-${p}-1 quy ước hoá đơn` }]]),
  ),
  scenario: "ok",
  delayMs: 2_500,
  slow: false,
});

const json = (status: number, body: Json) => Response.json(body, { status });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readKey(req: Request): { via: KhCall["via"]; value: string } {
  const x = req.headers.get("x-kh-key");
  if (x) return { via: "x-kh-key", value: x };
  const a = req.headers.get("authorization") ?? "";
  if (a.toLowerCase().startsWith("bearer ")) return { via: "bearer", value: a.slice(7).trim() };
  return { via: null, value: "" };
}

/** Lỗi theo kịch bản cho route dữ liệu; null = chạy bình thường. */
async function scenarioFail(st: KhState): Promise<Response | null> {
  switch (st.scenario) {
    case "server_error":
      return json(500, { detail: "Vector store error: boom" });
    case "server_error_once":
      st.scenario = "ok";
      return json(500, { detail: "Vector store error: once" });
    case "rate_limited":
      return json(429, { detail: "rate limited" });
    case "not_found":
      return json(404, { detail: "not found" });
    case "forbidden":
      return json(403, { detail: "missing permission project.read on this project" });
    case "timeout":
      await sleep(st.delayMs);
      return json(200, { hits: [] });
    case "bad_body":
      return new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    default:
      return null;
  }
}

function query(st: KhState, b: Json): Response {
  if (typeof b?.text !== "string" || !b.text) return json(422, { detail: "text required" });
  const project = String(b.project ?? "");
  if (!st.projects.includes(project))
    return json(403, { detail: "missing permission project.read on this project" });
  const k = Number(b.k ?? 1);
  const max = Number(b.max_chars ?? 0);
  const hits = [...(st.hits[project] ?? [])]
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map((h, i) => {
      const cut = max > 0 && h.source_text.length > max;
      return {
        vector_id: `vec_${project}_${i}`,
        score: h.score,
        source_text: cut ? h.source_text.slice(0, max) : h.source_text,
        summary: "",
        truncated: cut,
        ...(cut ? { text_len: h.source_text.length } : {}),
      };
    });
  return json(200, { hits });
}

function add(f: KhFake, b: Json): Response {
  if (typeof b?.text !== "string" || !b.text) return json(422, { detail: "text required" });
  const id = String(b.id ?? `vec_${b.text.length}`);
  const prev = f.vectors.get(id);
  f.vectors.set(id, {
    id,
    text: b.text,
    scope: b.scope,
    metadata: b.metadata,
    writes: (prev?.writes ?? 0) + 1,
  });
  return json(200, { status: "ok", vector_id: id, dimension: 1024 });
}

function healthRes(st: KhState): Response {
  return st.healthStatus === 200
    ? json(200, { status: "ok", model: st.model })
    : json(st.healthStatus, { detail: "down" });
}
/** Gate khoá chung (main.py `_require_api_key`); SSO ⇒ khoá tĩnh luôn bị từ chối. */
function gateOk(st: KhState, req: Request): boolean {
  if (st.sso) return false;
  return !st.auth || readKey(req).value === st.key;
}
function projectsRes(st: KhState): Response {
  if (st.projectsStatus !== 200) return json(st.projectsStatus, { detail: "projects error" });
  return json(200, {
    version: 1,
    projects: Object.fromEntries(st.projects.map((p) => [p, { id: p, visibility: "private" }])),
    store: { kind: "memory" },
  });
}

async function route(f: KhFake, req: Request, path: string, body: Json): Promise<Response> {
  const st = f.state;
  if (st.slow) await sleep(st.delayMs);
  if (path === "/health") return healthRes(st);
  if (!gateOk(st, req)) return json(401, { detail: "missing or invalid API key" });
  if (path === "/version" && req.method === "GET")
    return json(200, { version: st.version, source: "env", model: st.model });
  if (path === "/projects" && req.method === "GET") return projectsRes(st);
  if (req.method === "POST" && (path === "/vector/query" || path === "/vector/add")) {
    const fail = await scenarioFail(st);
    if (fail) return fail;
    return path === "/vector/query" ? query(st, body) : add(f, body);
  }
  return json(404, { detail: "Not Found" });
}

/** KH giả trên `host` (mặc định `localhost`; kết nối thứ hai dùng `127.0.0.1` để khác origin). */
export function startKhFake(key: string, projects: string[], host = "localhost"): KhFake {
  const f = {
    state: fresh(key, projects),
    calls: [] as KhCall[],
    vectors: new Map<string, KhVector>(),
  } as KhFake;
  const server = Bun.serve({
    port: 0,
    hostname: host === "localhost" ? undefined : host,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      let body: Json = null;
      if (req.method === "POST") body = await req.json().catch(() => null);
      const res = await route(f, req, url.pathname, body);
      const k = readKey(req);
      f.calls.push({
        method: req.method,
        path: url.pathname,
        sentKey: k.via !== null,
        via: k.via,
        keyOk: k.value === f.state.key,
        body,
        status: res.status,
      });
      return res;
    },
  });
  f.origin = `http://${host}:${server.port}`;
  f.base = f.origin;
  f.set = (patch) => {
    f.state = { ...f.state, ...patch };
  };
  f.reset = () => {
    f.state = fresh(key, projects);
    f.calls.length = 0;
    f.vectors.clear();
  };
  f.callsTo = (path) => f.calls.filter((c) => c.path === path);
  f.close = () => server.stop(true);
  return f;
}

/** Origin không có ai nghe (cho `unreachable`). */
export async function deadOrigin(): Promise<string> {
  const s = Bun.serve({ port: 0, fetch: () => new Response("x") });
  const o = `http://localhost:${s.port}`;
  await s.stop(true);
  return o;
}
