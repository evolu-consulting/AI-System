// HUB-FR-131 · HUB-FR-132 · HUB-FR-133 · CR-073 · plan K1 §7 · mock KnowledgeHub v6.4 chế độ khoá chung (spec §3.0; hình
// response theo `ai-sdlc-rowan/POC/KnowledgeHub/main.py` + `app/schemas.py`). Gate `X-KH-Key` | `Bearer` = `apiKey` (trừ
// `/health`) ⇒ sai/thiếu `401 {detail}`. Mỗi `createKhMock()` một trạng thái riêng (int test dựng 2 instance).
// Điều khiển: `PUT /__mock/kh`, `PUT /__mock/kh/projects/:id`, `GET /__mock/kh/calls`, `POST /__mock/kh/reset`.
import { type Context, Hono } from "hono";
import {
  freshKhState,
  KhMockConfigPatchSchema,
  KhMockHitsSchema,
  type KhMockState,
  recordCall,
} from "./state";

export type KhMockOptions = {
  apiKey?: string;
  /** trễ của kịch bản `timeout` (ms). */
  timeoutMs?: number;
  projects?: readonly string[];
};
export const KH_MOCK_DEFAULT_KEY = "mock-kh-key";

type Json = Record<string, unknown>;
const BEARER_RE = /^bearer (.+)$/i;

function readKey(c: Context): string | null {
  const x = c.req.header("x-kh-key");
  if (x) return x;
  return BEARER_RE.exec(c.req.header("authorization") ?? "")?.[1]?.trim() ?? null;
}

async function readBody(c: Context): Promise<Json | null> {
  try {
    const b: unknown = await c.req.json();
    return typeof b === "object" && b !== null && !Array.isArray(b) ? (b as Json) : null;
  } catch {
    return null;
  }
}

/** Lỗi theo kịch bản cho `/vector/*`; null = chạy bình thường. */
async function scenarioFail(st: KhMockState, delayMs: number): Promise<Response | null> {
  switch (st.cfg.scenario) {
    case "server_error":
      return Response.json({ detail: "Vector store error: mock" }, { status: 500 });
    case "server_error_once":
      st.cfg.scenario = "ok";
      return Response.json({ detail: "Vector store error: once" }, { status: 500 });
    case "rate_limited":
      return Response.json({ detail: "rate limited" }, { status: 429 });
    case "timeout":
      await Bun.sleep(delayMs);
      return Response.json({ hits: [] });
    case "bad_body":
      return new Response("<html>oops</html>", { headers: { "content-type": "text/html" } });
    default:
      return null;
  }
}

function query(st: KhMockState, b: Json | null): Response {
  if (typeof b?.text !== "string" || b.text === "")
    return Response.json({ detail: "text required" }, { status: 422 });
  const project = String(b.project ?? "");
  if (!st.cfg.projects.includes(project))
    return Response.json(
      { detail: "missing permission project.read on this project" },
      { status: 403 },
    );
  const k = Math.max(1, Math.min(50, Number(b.k ?? 5) || 5));
  const max = Number(b.max_chars ?? 0) || 0;
  const hits = [...(st.hits.get(project) ?? [])]
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
  return Response.json({ hits });
}

function add(st: KhMockState, b: Json | null): Response {
  if (typeof b?.text !== "string" || b.text === "")
    return Response.json({ detail: "text required" }, { status: 422 });
  const id = typeof b.id === "string" && b.id !== "" ? b.id : `vec_${st.vectors.size + 1}`;
  const prev = st.vectors.get(id);
  st.vectors.set(id, {
    id,
    text: b.text,
    scope: b.scope,
    metadata: b.metadata,
    writes: (prev?.writes ?? 0) + 1,
  });
  return Response.json({ status: "ok", vector_id: id, dimension: 1024 });
}

function projectsBody(st: KhMockState): Json {
  return {
    version: 1,
    projects: Object.fromEntries(
      st.cfg.projects.map((p) => [p, { id: p, name: p, visibility: "private" }]),
    ),
    store: { kind: "memory" },
  };
}

function mountControl(app: Hono, ref: { st: KhMockState }, reset: () => KhMockState): void {
  app.put("/__mock/kh", async (c) => {
    const r = KhMockConfigPatchSchema.safeParse(await readBody(c));
    if (!r.success) return c.json({ detail: "invalid mock config" }, 400);
    const { projects, ...rest } = r.data;
    const cfg = ref.st.cfg;
    Object.assign(cfg, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
    if (projects) cfg.projects = [...new Set(projects)];
    return c.json(cfg);
  });
  app.put("/__mock/kh/projects/:id", async (c) => {
    const r = KhMockHitsSchema.safeParse(await readBody(c));
    if (!r.success) return c.json({ detail: "invalid hits" }, 400);
    ref.st.hits.set(c.req.param("id"), r.data.hits);
    return c.body(null, 204);
  });
  app.get("/__mock/kh/calls", (c) =>
    c.json({ calls: ref.st.calls, vectors: [...ref.st.vectors.values()] }),
  );
  app.post("/__mock/kh/reset", (c) => {
    ref.st = reset();
    return c.body(null, 204);
  });
}

function mountGates(app: Hono, ref: { st: KhMockState }, apiKey: string): void {
  // Ghi nhật ký mọi lời gọi KH (không phải `/__mock/*`): có khoá không, khoá đúng không — không giá trị khoá.
  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/__mock/")) return next();
    const key = readKey(c);
    const body =
      c.req.method === "POST"
        ? await c.req.raw
            .clone()
            .json()
            .catch(() => null)
        : null;
    await next();
    recordCall(ref.st, {
      method: c.req.method,
      path: c.req.path,
      sent_key: key !== null,
      key_ok: key === apiKey,
      body,
      status: c.res.status,
    });
  });
  // Gate khoá chung (main.py `_require_api_key`); `key_rejected` = KH chế độ đăng nhập (Q27): khoá tĩnh luôn 401.
  app.use("*", async (c, next) => {
    if (c.req.path === "/health" || c.req.path.startsWith("/__mock/")) return next();
    const { auth, scenario } = ref.st.cfg;
    const ok = !auth || (scenario !== "key_rejected" && readKey(c) === apiKey);
    if (!ok) return c.json({ detail: "missing or invalid API key" }, 401);
    return next();
  });
}

function mountApi(app: Hono, ref: { st: KhMockState }, delayMs: number): void {
  app.get("/health", (c) => c.json({ status: "ok", model: ref.st.cfg.model }));
  app.get("/version", (c) =>
    c.json({ version: ref.st.cfg.version, source: "env", model: ref.st.cfg.model }),
  );
  app.get("/projects", (c) => c.json(projectsBody(ref.st)));
  app.post("/vector/query", async (c) => {
    const fail = await scenarioFail(ref.st, delayMs);
    return fail ?? query(ref.st, await readBody(c));
  });
  app.post("/vector/add", async (c) => {
    const fail = await scenarioFail(ref.st, delayMs);
    return fail ?? add(ref.st, await readBody(c));
  });
  app.notFound((c) => c.json({ detail: "Not Found" }, 404));
}

export function createKhMock(opts: KhMockOptions = {}): Hono {
  const reset = () => freshKhState(opts.projects);
  const ref = { st: reset() };
  const app = new Hono();
  mountControl(app, ref, reset);
  mountGates(app, ref, opts.apiKey ?? KH_MOCK_DEFAULT_KEY);
  mountApi(app, ref, opts.timeoutMs ?? 30_000);
  return app;
}
