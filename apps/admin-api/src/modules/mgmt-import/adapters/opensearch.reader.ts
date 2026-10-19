// I1 · đọc chỉ-đọc các index OpenSearch của mgmt-app qua REST (không thêm thư viện): scroll theo lô, sắp `_doc`, bỏ
// `embedding` (vector không chuyển — knowledge tự dựng lại). Index chưa có (404) ⇒ rỗng. Chỉ GET/POST tìm kiếm + xoá scroll.
import type { SourceDoc, SourceReader } from "../application/ports";

export type OsOpts = { url: string; prefix?: string; fetch?: typeof fetch };

type Hit = { _id: string; _source: Record<string, unknown> };
type Page = { _scroll_id?: string; hits?: { hits?: Hit[] } };

export function createOpenSearchReader(o: OsOpts): Pick<SourceReader, "scan" | "count"> {
  const f = o.fetch ?? fetch;
  const base = o.url.replace(/\/+$/, "");
  const ix = (name: string) => encodeURIComponent(`${o.prefix ?? ""}${name}`);
  const post = async (path: string, body: unknown): Promise<Response> =>
    f(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const json = async (r: Response, what: string): Promise<Page & { count?: number }> => {
    if (!r.ok) throw new Error(`OPENSEARCH_${what}_${r.status}`);
    return (await r.json()) as Page & { count?: number };
  };
  return {
    async count(index) {
      const r = await f(`${base}/${ix(index)}/_count`);
      if (r.status === 404) return 0;
      return (await json(r, "COUNT")).count ?? 0;
    },
    async *scan(index, batch) {
      const first = await post(`/${ix(index)}/_search?scroll=2m`, {
        size: batch,
        sort: ["_doc"],
        _source: { excludes: ["embedding"] },
        query: { match_all: {} },
      });
      if (first.status === 404) return;
      let page = await json(first, "SEARCH");
      try {
        for (;;) {
          const hits = page.hits?.hits ?? [];
          if (hits.length === 0) return;
          yield hits.map((h): SourceDoc => ({ id: h._id, src: h._source }));
          page = await json(
            await post("/_search/scroll", { scroll: "2m", scroll_id: page._scroll_id }),
            "SCROLL",
          );
        }
      } finally {
        if (page._scroll_id)
          await f(`${base}/_search/scroll`, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ scroll_id: page._scroll_id }),
          }).catch(() => undefined);
      }
    },
  };
}
