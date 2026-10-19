// R1 · nguồn KH: cấu hình từ env (thiếu ⇒ tắt), danh sách tenant, gọi `POST /vector/query` qua `KhClient` (khoá ở header
// `X-KH-Key`, không trong URL/thân), lỗi HTTP ⇒ ném (bên gọi bỏ nguồn). `fetch` giả — không mạng.
import { describe, expect, it } from "bun:test";
import { khSource, khSourceConfig } from "./kh.source";

const ENV = {
  KNOWLEDGE_KH_URL: "http://127.0.0.1:4030",
  KNOWLEDGE_KH_KEY: "kh-test-key-not-secret",
  KNOWLEDGE_KH_PROJECT: "evolu",
  KNOWLEDGE_KH_TENANTS:
    "7E5D0000-0000-4000-8000-000000000001, 7e5d0000-0000-4000-8000-000000000002",
};

describe("R1 · khSourceConfig", () => {
  it("thiếu URL/key/project hoặc URL sai ⇒ null (tắt)", () => {
    for (const k of ["KNOWLEDGE_KH_URL", "KNOWLEDGE_KH_KEY", "KNOWLEDGE_KH_PROJECT"] as const)
      expect(khSourceConfig({ ...ENV, [k]: undefined })).toBeNull();
    expect(khSourceConfig({ ...ENV, KNOWLEDGE_KH_URL: "not a url" })).toBeNull();
  });
  it("tenant: danh sách (không phân biệt hoa thường) | '*' | vắng ⇒ không ai", () => {
    const c = khSourceConfig(ENV);
    const s =
      c &&
      khSource(c, {
        dev: true,
        fetch: (async () => new Response("{}")) as unknown as typeof fetch,
      });
    expect(s?.allows("7e5d0000-0000-4000-8000-000000000001")).toBe(true);
    expect(s?.allows("7e5d0000-0000-4000-8000-000000000003")).toBe(false);
    const all = khSourceConfig({ ...ENV, KNOWLEDGE_KH_TENANTS: "*" });
    expect(all && khSource(all, { dev: true }).allows("x")).toBe(true);
    const none = khSourceConfig({ ...ENV, KNOWLEDGE_KH_TENANTS: undefined });
    expect(
      none && khSource(none, { dev: true }).allows("7e5d0000-0000-4000-8000-000000000001"),
    ).toBe(false);
  });
});

describe("R1 · khSource.search", () => {
  it("POST /vector/query {text, project} với X-KH-Key; thân ⇒ hit `kh:`", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return Response.json({
        hits: [{ score: 0.8, source_text: "ADR-0021 gộp hai RAG", id: "a21" }],
      });
    }) as unknown as typeof fetch;
    const s = khSource(khSourceConfig(ENV) as NonNullable<ReturnType<typeof khSourceConfig>>, {
      dev: true,
      fetch: f,
    });
    const hits = await s.search("gộp RAG", 5);
    expect(hits.map((h) => h.chunkId)).toEqual(["kh:a21"]);
    expect(seen[0]?.url).toBe("http://127.0.0.1:4030/vector/query");
    const h = seen[0]?.init.headers as Record<string, string>;
    expect(h["X-KH-Key"] ?? h["x-kh-key"]).toBe(ENV.KNOWLEDGE_KH_KEY);
    const body = JSON.parse(String(seen[0]?.init.body));
    expect(body).toMatchObject({ text: "gộp RAG", project: "evolu" });
    expect(JSON.stringify(body).includes(ENV.KNOWLEDGE_KH_KEY)).toBe(false);
  });
  it("HTTP 500 ⇒ ném (KhCallError), không lộ khoá trong message", async () => {
    const f = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    const s = khSource(khSourceConfig(ENV) as NonNullable<ReturnType<typeof khSourceConfig>>, {
      dev: true,
      fetch: f,
    });
    const err = await s.search("q", 5).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message).includes(ENV.KNOWLEDGE_KH_KEY)).toBe(false);
  });
});
