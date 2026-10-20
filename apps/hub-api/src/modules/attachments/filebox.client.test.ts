// HUB-FR-138 · nợ #212: `#retry`/`#attempt` gom tham số thành một object — hành vi giữ nguyên: GET 5xx ⇒ thử lại theo
// `retryDelaysMs` cùng method/path/token; POST không retry; 401 ⇒ làm mới token đúng một lần. Máy chủ giả cục bộ (Bun.serve).
import { afterAll, describe, expect, test } from "bun:test";
import { FileboxClient } from "./filebox.client";

type Hit = { method: string; path: string; auth: string | null };
const hits: Hit[] = [];
let plan: number[] = [];
const srv = Bun.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url);
    hits.push({ method: req.method, path: u.pathname, auth: req.headers.get("authorization") });
    const status = plan.shift() ?? 200;
    return Response.json({ url: "/d/x" }, { status });
  },
});
afterAll(() => srv.stop(true));

const log = { warn: () => undefined, info: () => undefined, error: () => undefined };
function client(tokens: string[]) {
  return new FileboxClient({
    url: `http://localhost:${srv.port}`,
    org: "t_x",
    token: { get: async () => tokens[0] ?? null, refresh: async () => tokens[1] ?? null },
    timeoutMs: 2000,
    retryDelaysMs: [0, 0],
    log: log as never,
  });
}
const reset = (p: number[]) => {
  hits.length = 0;
  plan = p;
};

describe("FileboxClient · #retry gom tham số (#212)", () => {
  test("GET 503 ⇒ thử lại cùng method/path/token tới khi 200", async () => {
    reset([503, 503, 200]);
    expect(await client(["a"]).getLink("f1")).toBe(`http://localhost:${srv.port}/d/x`);
    expect(hits).toEqual(
      Array.from({ length: 3 }, () => ({
        method: "GET",
        path: "/files/f1/link",
        auth: "Bearer a",
      })),
    );
  });
  test("DELETE hết lượt retry vẫn 503 ⇒ ném", async () => {
    reset([503, 503, 503]);
    await expect(client(["a"]).deleteFile("f1")).rejects.toThrow("filebox delete 503");
    expect(hits.length).toBe(3);
  });
  test("POST 503 ⇒ không retry (một request), ném", async () => {
    reset([503]);
    await expect(client(["a"]).postFile("a.pdf", new Uint8Array([1]))).rejects.toThrow();
    expect(hits.length).toBe(1);
  });
  test("401 ⇒ làm mới token một lần, retry dùng token mới", async () => {
    reset([401, 503, 200]);
    expect(await client(["a", "b"]).deleteFile("f1")).toBe("deleted");
    expect(hits.map((h) => h.auth)).toEqual(["Bearer a", "Bearer b", "Bearer b"]);
  });
});

describe("FileboxClient · publicPath (FileBox riêng nội bộ)", () => {
  test("getLink trả đường dẫn tương đối <prefix>/d/… thay vì origin nội bộ", async () => {
    reset([200]);
    const c = new FileboxClient({
      url: `http://localhost:${srv.port}`,
      org: "t_x",
      token: { get: async () => "a", refresh: async () => null },
      publicPath: "/_fb",
      timeoutMs: 2000,
      retryDelaysMs: [],
      log: log as never,
    });
    expect(await c.getLink("f1")).toBe("/_fb/d/x");
  });
});
