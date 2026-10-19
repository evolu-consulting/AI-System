// I1 · đọc chỉ-đọc đồ thị Neo4j của mgmt-app qua HTTP API giao dịch (`/db/<db>/tx/commit`, không thêm driver). Mỗi truy vấn
// là MATCH … RETURN (không ghi), phân trang ORDER BY + SKIP/LIMIT theo lô. Hàng = mảng giá trị theo thứ tự cột RETURN.
import type { GraphQuery, SourceReader } from "../application/ports";

export type Neo4jOpts = {
  url: string;
  user: string;
  password: string;
  database?: string;
  fetch?: typeof fetch;
};

/** Truy vấn đọc theo loại cạnh/nút (G1 + đồ thị hợp đồng); `$skip/$limit` do reader gắn. */
export const GRAPH_QUERIES: Record<GraphQuery, string> = {
  entities: "MATCH (e:Entity) RETURN e.key, e.name, e.type ORDER BY e.key",
  mentions: "MATCH (c:Chunk)-[:MENTIONS]->(e:Entity) RETURN c.id, e.key ORDER BY c.id, e.key",
  rels: "MATCH (a:Entity)-[x:REL]->(b:Entity) RETURN a.key, b.key, x.type, x.evidence_chunk ORDER BY a.key, x.type, b.key",
  aliases: "MATCH (a:Entity)-[:ALIAS_OF]->(b:Entity) RETURN a.key, b.key ORDER BY a.key, b.key",
  chunk_links:
    "MATCH (x:Chunk)-[s:SIMILAR|CONFLICTS]->(y:Chunk) RETURN x.id, y.id, type(s), s.score, s.reason ORDER BY x.id, y.id, type(s)",
  doc_links: "MATCH (a:Document)-[:LINKS_TO]->(b:Document) RETURN a.id, b.id ORDER BY a.id, b.id",
  doc_chunks:
    "MATCH (d:Document)-[:HAS_CHUNK]->(c:Chunk) RETURN d.id, c.id, c.index ORDER BY d.id, c.index",
  contract_graph:
    "MATCH (c:Contract)-[r]->(n) RETURN c.id, type(r), labels(n)[0], coalesce(n.key, n.id) ORDER BY c.id, type(r), coalesce(n.key, n.id)",
};

type TxResult = {
  results?: { data?: { row: unknown[] }[] }[];
  errors?: { code: string; message: string }[];
};

export function createNeo4jReader(o: Neo4jOpts): Pick<SourceReader, "graph"> {
  const f = o.fetch ?? fetch;
  const url = `${o.url.replace(/\/+$/, "")}/db/${encodeURIComponent(o.database ?? "neo4j")}/tx/commit`;
  const auth = `Basic ${Buffer.from(`${o.user}:${o.password}`).toString("base64")}`;
  const query = async (
    statement: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown[][]> => {
    const r = await f(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: auth,
      },
      body: JSON.stringify({
        statements: [{ statement, parameters, resultDataContents: ["row"] }],
      }),
    });
    if (!r.ok) throw new Error(`NEO4J_HTTP_${r.status}`);
    const body = (await r.json()) as TxResult;
    if (body.errors?.length) throw new Error(`NEO4J_${body.errors[0]?.code ?? "ERROR"}`);
    return (body.results?.[0]?.data ?? []).map((d) => d.row);
  };
  return {
    async *graph(q, batch) {
      for (let skip = 0; ; skip += batch) {
        const rows = await query(`${GRAPH_QUERIES[q]} SKIP $skip LIMIT $limit`, {
          skip,
          limit: batch,
        });
        if (rows.length > 0) yield rows;
        if (rows.length < batch) return;
      }
    },
  };
}
