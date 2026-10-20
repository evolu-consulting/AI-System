// niti-filebox · client FileBox của importer: org theo tham số, Bearer, POST không retry, 5xx/thiếu id ⇒ FILEBOX_UNAVAILABLE,
// đọc lại bytes, chặn khác origin. Máy chủ giả cục bộ (Bun.serve cổng 0).
import { afterAll, describe, expect, test } from "bun:test";
import { createFileboxHttp, sameOrigin } from "./filebox.http";
import { createFileboxSink } from "./files.adapter";

const seen: { method: string; path: string; auth: string | null }[] = [];
const store = new Map<string, Uint8Array>();
let failPost = 0;
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url);
    seen.push({
      method: req.method,
      path: `${u.pathname}${u.search}`,
      auth: req.headers.get("authorization"),
    });
    if (req.method === "POST") {
      if (failPost > 0) {
        failPost--;
        return new Response("x", { status: 503 });
      }
      const id = `f${store.size + 1}`;
      store.set(id, new Uint8Array(await req.arrayBuffer()));
      return Response.json({ file_id: id, version_id: `v-${id}` }, { status: 200 });
    }
    const m = /^\/files\/([^/]+)\/content$/.exec(u.pathname);
    const b = m ? store.get(m[1] ?? "") : undefined;
    return b ? new Response(b as Uint8Array<ArrayBuffer>) : new Response("no", { status: 404 });
  },
});
const url = `http://127.0.0.1:${server.port}`;
afterAll(() => server.stop(true));

describe("niti-filebox · filebox.http", () => {
  test("put org t_<tenant> + Bearer; readBack đúng bytes; id lạ ⇒ null", async () => {
    const sink = createFileboxSink(createFileboxHttp({ url, token: "tk" }));
    const up = await sink.put("t_abc", "hợp đồng.pdf", new TextEncoder().encode("%PDF x"));
    expect(up).toEqual({ fileId: "f1", versionId: "v-f1" });
    expect(seen.at(-1)).toEqual({
      method: "POST",
      path: `/files?org=t_abc&name=${encodeURIComponent("hợp đồng.pdf")}`,
      auth: "Bearer tk",
    });
    expect(new TextDecoder().decode((await sink.readBack("f1", "t_abc")) ?? new Uint8Array())).toBe(
      "%PDF x",
    );
    expect(await sink.readBack("nope", "t_abc")).toBeNull();
  });

  test("POST 5xx ⇒ FILEBOX_UNAVAILABLE, KHÔNG thử lại (tránh upload trùng)", async () => {
    failPost = 1;
    const n = seen.length;
    await expect(
      createFileboxHttp({ url, token: "tk" })("t_x").postFile("a", new Uint8Array([1])),
    ).rejects.toThrow("FILEBOX_UNAVAILABLE");
    expect(seen.length - n).toBe(1);
  });

  test("sameOrigin: cùng origin, không userinfo", () => {
    expect(sameOrigin(url, `${url}/files`)).toBe(true);
    expect(sameOrigin(url, "http://evil.test/files")).toBe(false);
    expect(sameOrigin(url, `http://u:p@127.0.0.1:${server.port}/x`)).toBe(false);
  });
});
