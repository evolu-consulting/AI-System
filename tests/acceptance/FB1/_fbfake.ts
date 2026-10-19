// HUB-FR-138 · HUB-FR-139 · HUB-FR-142 · FileBox GIẢ của qc (spec FB1 §3.7): Bun.serve cổng 0, trạng thái trong bộ nhớ, hợp đồng = thật:
//   `POST /files?org=&name=` (Bearer bắt buộc; thân = byte thô) ⇒ 201 {file_id, version_id, org, name, size} · 413 khi vượt `maxBytes`
//   `GET /files/:id/content` (Range ⇒ 206) · 404 id lạ/đã xoá      `GET /files/:id/link` ⇒ 200 {url:"/d/<rand>"} · 404
//   `GET /files/:id/versions` ⇒ 200 {versions:[{version_id,size}]} · `DELETE /files/:id` ⇒ 204 · 404 nếu đã xoá (idempotent ở phía Hub)
//   `GET /health` ⇒ 200 (không cần Bearer) · `GET /d/:rand` ⇒ byte (đích của link; không cần Bearer, như link thật)
// Thiếu/sai Bearer ⇒ 401. Ghi mọi lời gọi (`calls`: KHÔNG lưu giá trị token) để ca đếm "gọi/không gọi FileBox". Kịch bản lỗi:
// `failNext(route, [status…])` (hàng đợi) · `failAlways(route, status)`. ĐỘC LẬP code sản phẩm — test khoá không phụ thuộc code chưa
// có. Không chứa `it(...)`.

export type FbRoute = "post" | "content" | "link" | "versions" | "delete" | "health" | "d";
export type FbCall = {
  method: string;
  route: FbRoute;
  path: string;
  org: string | null;
  name: string | null;
  /** "ok" = Bearer đúng · "bad" = có nhưng sai · "none" = không gửi. */
  auth: "ok" | "bad" | "none";
  range: string | null;
  /** byte thân request (POST). */
  bytes: number;
  status: number;
  fileId: string | null;
};
type FbFile = {
  id: string;
  org: string;
  name: string;
  versions: { id: string; bytes: Uint8Array }[];
};

export type FbFake = {
  /** `http://127.0.0.1:<port>` — chính là `FILEBOX_URL` của Hub trong test. */
  origin: string;
  token: string;
  calls: FbCall[];
  /** đổi Bearer hợp lệ (mô phỏng xoay khoá). */
  setToken: (t: string) => void;
  setMaxBytes: (n: number) => void;
  failNext: (route: FbRoute, statuses: number[]) => void;
  failAlways: (route: FbRoute, status: number | null) => void;
  /** nạp sẵn một file (không đi qua API) → `{file_id, version_id}`. */
  put: (bytes: Uint8Array, name?: string, org?: string) => { file_id: string; version_id: string };
  has: (fileId: string) => boolean;
  /** file còn sống (id). */
  ids: () => string[];
  bytesOf: (fileId: string) => Uint8Array | undefined;
  /** xoá khỏi kho giả mà không ghi `calls` (mô phỏng file mất phía FileBox). */
  vanish: (fileId: string) => void;
  /** Xoá mọi tệp đã lưu (`reset()` chỉ xoá nhật ký/hàng đợi lỗi) — cho ca cần `ids()` rỗng. */
  wipe: () => void;
  callsTo: (route: FbRoute) => FbCall[];
  reset: () => void;
  close: () => Promise<void>;
};

const enc = new TextEncoder();
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Matched = { route: FbRoute | null; fileId: string | null; rand: string };
/** Định tuyến theo method + path (hợp đồng FileBox thật, spec §3.7). */
function match(method: string, path: string): Matched {
  const none: Matched = { route: null, fileId: null, rand: "" };
  if (path === "/files" && method === "POST") return { ...none, route: "post" };
  if (path === "/health") return { ...none, route: "health" };
  const d = /^\/d\/([^/]+)$/.exec(path);
  if (d) return { ...none, route: "d", rand: d[1] ?? "" };
  const sub = /^\/files\/([^/]+)\/(content|link|versions)$/.exec(path);
  if (sub && method === "GET") return { ...none, route: sub[2] as FbRoute, fileId: sub[1] ?? null };
  const one = /^\/files\/([^/]+)$/.exec(path);
  if (one && method === "DELETE") return { ...none, route: "delete", fileId: one[1] ?? null };
  return none;
}

export function startFbFake(token = "fb-test-token-Zx9Pq7Lm"): FbFake {
  const files = new Map<string, FbFile>();
  const links = new Map<string, string>();
  const queue = new Map<FbRoute, number[]>();
  const always = new Map<FbRoute, number>();
  const st = { token, maxBytes: 64 * 1024 * 1024, seq: 0 };
  const calls: FbCall[] = [];
  const nid = (p: string) =>
    `${p}-${(++st.seq).toString(16).padStart(6, "0")}-${crypto.randomUUID().slice(0, 8)}`;

  const injected = (route: FbRoute): number | null => {
    const q = queue.get(route);
    if (q && q.length > 0) return q.shift() ?? null;
    return always.get(route) ?? null;
  };

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { route, fileId, rand } = match(req.method, url.pathname);
    const hdr = req.headers.get("authorization");
    const auth: FbCall["auth"] = !hdr ? "none" : hdr === `Bearer ${st.token}` ? "ok" : "bad";
    const rec: FbCall = {
      method: req.method,
      route: route ?? "health",
      path: url.pathname,
      org: url.searchParams.get("org"),
      name: url.searchParams.get("name"),
      auth,
      range: req.headers.get("range"),
      bytes: 0,
      status: 0,
      fileId,
    };
    const done = (r: Response) => {
      rec.status = r.status;
      calls.push(rec);
      return r;
    };
    if (!route) return done(json(404, { detail: "not found" }));
    if (route === "health") return done(json(200, { status: "ok" }));
    if (route === "d") return done(serveLink(rand, req));
    // đọc hết thân POST trước khi trả lỗi (kết nối sạch)
    const body = route === "post" ? new Uint8Array(await req.arrayBuffer()) : new Uint8Array();
    rec.bytes = body.length;
    return done(respond(route, auth, url, body, fileId ?? "", req));
  }

  function respond(
    route: FbRoute,
    auth: FbCall["auth"],
    url: URL,
    body: Uint8Array,
    fileId: string,
    req: Request,
  ): Response {
    if (auth !== "ok") return json(401, { detail: "missing or invalid token" });
    const inj = injected(route);
    if (inj !== null) return json(inj, { detail: `injected ${inj}` });
    return route === "post" ? post(url, body) : fileRoute(route, fileId, req);
  }

  function post(url: URL, body: Uint8Array): Response {
    const org = url.searchParams.get("org");
    const name = url.searchParams.get("name");
    if (!org || !name) return json(422, { detail: "org and name required" });
    if (body.length > st.maxBytes) return json(413, { detail: "too large" });
    const f: FbFile = { id: nid("f"), org, name, versions: [{ id: nid("v"), bytes: body }] };
    files.set(f.id, f);
    return json(201, {
      file_id: f.id,
      version_id: f.versions[0]?.id,
      org,
      name,
      size: body.length,
    });
  }

  function fileRoute(route: FbRoute, id: string, req: Request): Response {
    const f = files.get(id);
    if (!f) return json(404, { detail: "file not found" });
    const cur = f.versions[f.versions.length - 1] as FbFile["versions"][number];
    if (route === "delete") {
      files.delete(id);
      return new Response(null, { status: 204 });
    }
    if (route === "versions")
      return json(200, {
        versions: f.versions.map((v) => ({ version_id: v.id, size: v.bytes.length })),
      });
    if (route === "link") {
      const rand = nid("d");
      links.set(rand, id);
      return json(200, { url: `/d/${rand}` });
    }
    return bytesResponse(cur.bytes, req);
  }

  function bytesResponse(b: Uint8Array, req: Request): Response {
    const range = req.headers.get("range");
    const r = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (!r)
      return new Response(b as unknown as BodyInit, {
        status: 200,
        headers: { "content-length": String(b.length) },
      });
    const s = Number(r[1]);
    const e = r[2] ? Math.min(Number(r[2]), b.length - 1) : b.length - 1;
    if (s >= b.length) return new Response(null, { status: 416 });
    const part = b.subarray(s, e + 1);
    return new Response(part as unknown as BodyInit, {
      status: 206,
      headers: {
        "content-range": `bytes ${s}-${e}/${b.length}`,
        "content-length": String(part.length),
      },
    });
  }

  function serveLink(rand: string, req: Request): Response {
    const id = links.get(rand);
    const f = id ? files.get(id) : undefined;
    if (!f) return json(404, { detail: "link expired" });
    return bytesResponse(
      (f.versions[f.versions.length - 1] as FbFile["versions"][number]).bytes,
      req,
    );
  }

  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handle, idleTimeout: 30 });
  const origin = `http://127.0.0.1:${server.port}`;
  return {
    origin,
    get token() {
      return st.token;
    },
    calls,
    setToken: (t) => {
      st.token = t;
    },
    setMaxBytes: (n) => {
      st.maxBytes = n;
    },
    failNext: (route, statuses) => {
      queue.set(route, [...statuses]);
    },
    failAlways: (route, status) => {
      if (status === null) always.delete(route);
      else always.set(route, status);
    },
    put: (bytes, name = "seed", org = "ai-system") => {
      const f: FbFile = { id: nid("f"), org, name, versions: [{ id: nid("v"), bytes }] };
      files.set(f.id, f);
      return { file_id: f.id, version_id: f.versions[0]?.id ?? "" };
    },
    has: (id) => files.has(id),
    ids: () => [...files.keys()],
    bytesOf: (id) => files.get(id)?.versions.at(-1)?.bytes,
    vanish: (id) => {
      files.delete(id);
    },
    wipe: () => {
      files.clear();
    },
    callsTo: (route) => calls.filter((c) => c.route === route),
    reset: () => {
      calls.length = 0;
      queue.clear();
      always.clear();
    },
    close: async () => {
      await server.stop(true);
    },
  } as FbFake;
}

/** Chuỗi byte → `Uint8Array` (tiện cho ca). */
export const utf8 = (s: string): Uint8Array => enc.encode(s);
