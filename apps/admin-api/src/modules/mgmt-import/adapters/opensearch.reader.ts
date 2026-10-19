// I1 · đọc chỉ-đọc các index OpenSearch của mgmt-app qua REST (không thêm thư viện): scroll theo lô, sắp `_doc`, bỏ
// `embedding` (vector không chuyển — knowledge tự dựng lại). Index chưa có (404) ⇒ rỗng. Chỉ GET/POST tìm kiếm + xoá scroll.
// Mọi phản hồi đọc hết thân (kể cả 404/lỗi); mỗi lời gọi có trần thời gian riêng ⇒ lỗi rõ mã, không treo.
import type { SourceDoc, SourceReader } from "../application/ports";

export type OsOpts = { url: string; prefix?: string; fetch?: typeof fetch; timeoutMs?: number };

type Hit = { _id: string; _source: Record<string, unknown> };
type Page = { _scroll_id?: string; hits?: { hits?: Hit[] }; count?: number };
type Res = { status: number; body: Page };

export function createOpenSearchReader(o: OsOpts): Pick<SourceReader, "scan" | "count"> {
  const f = o.fetch ?? fetch;
  const base = o.url.replace(/\/+$/, "");
  const ix = (name: string) => encodeURIComponent(`${o.prefix ?? ""}${name}`);
  const call = async (method: string, path: string, body?: unknown): Promise<Res> => {
    const r = await f(`${base}${path}`, {
      method,
      // Bun mặc định xin `gzip, deflate, br, zstd`; OpenSearch 2.19 chọn mã khác gzip ⇒ fetch của Bun treo (đo trên
      // evotest-mgmt: mọi lời gọi treo tới timeout; `identity`/`gzip` ⇒ 3–8 ms). Xin thẳng `identity`.
      headers: { "content-type": "application/json", "accept-encoding": "identity" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
    }).catch((e: unknown) => {
      throw new Error(
        (e as Error)?.name === "TimeoutError" ? "OPENSEARCH_TIMEOUT" : "OPENSEARCH_UNREACHABLE",
      );
    });
    const text = await r.text();
    return { status: r.status, body: text ? (JSON.parse(text) as Page) : {} };
  };
  const ok = (r: Res, what: string): Page => {
    if (r.status < 200 || r.status >= 300) throw new Error(`OPENSEARCH_${what}_${r.status}`);
    return r.body;
  };
  return {
    async count(index) {
      const r = await call("GET", `/${ix(index)}/_count`);
      return r.status === 404 ? 0 : (ok(r, "COUNT").count ?? 0);
    },
    async *scan(index, batch) {
      const first = await call("POST", `/${ix(index)}/_search?scroll=2m`, {
        size: batch,
        sort: ["_doc"],
        _source: { excludes: ["embedding"] },
        query: { match_all: {} },
      });
      if (first.status === 404) return;
      let page = ok(first, "SEARCH");
      try {
        for (;;) {
          const hits = page.hits?.hits ?? [];
          if (hits.length === 0) return;
          yield hits.map((h): SourceDoc => ({ id: h._id, src: h._source }));
          page = ok(
            await call("POST", "/_search/scroll", { scroll: "2m", scroll_id: page._scroll_id }),
            "SCROLL",
          );
        }
      } finally {
        if (page._scroll_id)
          await call("DELETE", "/_search/scroll", { scroll_id: page._scroll_id }).catch(
            () => undefined,
          );
      }
    },
  };
}
