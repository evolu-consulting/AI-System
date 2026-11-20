// CR-102 · C3 · adapter http: đúng route/method của hub-api `/pack/community/*` (fetch giả, không mạng).
import { afterEach, describe, expect, it } from "bun:test";
import { clearFileBlobs } from "~/shared/kernel/file-blob-cache";
import { createHttpApi, feedQueryString } from "./http";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

function capture(status = 200, body: unknown = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

describe("community http adapter", () => {
  it("feed: bỏ giá trị rỗng, mine/limit thành chuỗi", async () => {
    expect(feedQueryString({ tab: "sell", mine: true, limit: 5, q: undefined })).toMatchObject({
      tab: "sell",
      mine: "true",
      limit: 5,
    });
    const calls = capture(200, { items: [] });
    await createHttpApi().listFeed({ tab: "all", cat: "dong-goi", mine: false });
    expect(calls[0]?.url).toBe("/pack/community/feed?tab=all&cat=dong-goi");
  });
  it("route + method từng thao tác; xoá (204) ⇒ null", async () => {
    const api = createHttpApi();
    const calls = capture(200, {});
    await api.getViewer();
    await api.updatePost("p1", { title: "x" });
    await api.listComments("p1");
    await api.deleteComment("p1", "c1");
    await api.getProfile();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /pack/community/viewer",
      "PATCH /pack/community/posts/p1",
      "GET /pack/community/posts/p1/comments?limit=100",
      "DELETE /pack/community/posts/p1/comments/c1",
      "GET /pack/community/profile",
    ]);
    capture(204);
    expect(await api.postAction("p1", { action: "delete" })).toBeNull();
  });
  it("[CR-195] ảnh đã tải thì lần mở lại không gọi mạng; đăng xuất (xoá cache) ⇒ tải lại", async () => {
    const urlApi = URL as unknown as { createObjectURL: (b: Blob) => string };
    const realCreate = urlApi.createObjectURL;
    urlApi.createObjectURL = () => "blob:giả";
    try {
      clearFileBlobs();
      const calls = capture(200, {});
      const api = createHttpApi();
      await api.fileObjectUrl("fa");
      await api.fileObjectUrl("fa");
      expect(calls.map((c) => c.url)).toEqual(["/pack/community/files/fa"]);
      clearFileBlobs();
      await api.fileObjectUrl("fa");
      expect(calls.length).toBe(2);
    } finally {
      urlApi.createObjectURL = realCreate;
      clearFileBlobs();
    }
  });
});
