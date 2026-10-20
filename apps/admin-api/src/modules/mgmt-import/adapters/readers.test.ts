// I1 · reader nguồn trên fetch GIẢ: OpenSearch scroll theo lô (bỏ embedding, 404 ⇒ rỗng, xoá scroll khi xong), Neo4j HTTP
// phân trang SKIP/LIMIT, lỗi Cypher ⇒ ném mã. Không mạng thật.
import { expect, test } from "bun:test";
import { createNeo4jReader } from "./neo4j.reader";
import { createOpenSearchReader } from "./opensearch.reader";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("OpenSearch: hai trang scroll rồi hết; gửi excludes embedding; xoá scroll", async () => {
  const calls: { url: string; method: string; body: unknown; enc?: string }[] = [];
  const pages = [
    {
      _scroll_id: "s1",
      hits: {
        hits: [
          { _id: "a", _source: { x: 1 } },
          { _id: "b", _source: { x: 2 } },
        ],
      },
    },
    { _scroll_id: "s1", hits: { hits: [{ _id: "c", _source: { x: 3 } }] } },
    { _scroll_id: "s1", hits: { hits: [] } },
  ];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
      enc: (init?.headers as Record<string, string> | undefined)?.["accept-encoding"],
    });
    return init?.method === "DELETE" ? json({}) : json(pages.shift());
  }) as unknown as typeof fetch;
  const r = createOpenSearchReader({ url: "http://os:9200/", prefix: "p_", fetch: fake });
  const got: string[][] = [];
  for await (const page of r.scan("contracts", 2)) got.push(page.map((d) => d.id));
  expect(got).toEqual([["a", "b"], ["c"]]);
  expect(calls[0]?.url).toBe("http://os:9200/p_contracts/_search?scroll=2m");
  expect(calls[0]?.body).toMatchObject({ size: 2, _source: { excludes: ["embedding"] } });
  expect(calls.at(-1)?.method).toBe("DELETE");
  // OpenSearch 2.19 + mã nén mặc định của Bun ⇒ treo; mọi lời gọi xin `identity`
  expect(calls.every((c) => c.enc === "identity")).toBe(true);
});

test("OpenSearch: index không có (404) ⇒ không lô nào, count 0", async () => {
  const fake = (async () => json({}, 404)) as unknown as typeof fetch;
  const r = createOpenSearchReader({ url: "http://os", fetch: fake });
  const pages = [];
  for await (const p of r.scan("x", 10)) pages.push(p);
  expect(pages).toEqual([]);
  expect(await r.count("x")).toBe(0);
});

test("Neo4j: SKIP/LIMIT tới khi trang thiếu; lỗi Cypher ⇒ NEO4J_<mã>", async () => {
  const seen: number[] = [];
  const rows = [[["a"], ["b"]], [["c"]]];
  const fake = (async (_u: string, init?: RequestInit) => {
    const st = JSON.parse(String(init?.body)).statements[0];
    seen.push(st.parameters.skip);
    expect(st.statement).toContain("SKIP $skip LIMIT $limit");
    return json({
      results: [{ data: (rows.shift() ?? []).map((row) => ({ row })) }],
      errors: [],
    });
  }) as unknown as typeof fetch;
  const r = createNeo4jReader({
    url: "http://neo:7474",
    user: "neo4j",
    password: "pw",
    fetch: fake,
  });
  const out: unknown[] = [];
  for await (const p of r.graph("entities", 2)) out.push(...p);
  expect(out).toEqual([["a"], ["b"], ["c"]]);
  expect(seen).toEqual([0, 2]);
  const bad = createNeo4jReader({
    url: "http://neo",
    user: "u",
    password: "p",
    fetch: (async () =>
      json({
        results: [],
        errors: [{ code: "Neo.ClientError.Statement.SyntaxError", message: "x" }],
      })) as unknown as typeof fetch,
  });
  await expect(
    (async () => {
      for await (const _ of bad.graph("rels", 5)) {
        /* noop */
      }
    })(),
  ).rejects.toThrow("NEO4J_Neo.ClientError.Statement.SyntaxError");
});
