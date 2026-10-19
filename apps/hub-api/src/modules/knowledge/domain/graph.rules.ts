// G1 · CR-095: luật thuần của đồ thị tri thức — giới hạn đầu vào và dựng {nodes, links} từ hàng SQL đúng như
// `graph.neighbourhood` / `graph.corpus` của mgmt-app (node tài liệu id = id tài liệu, node thực thể id = key; MENTIONS ghi đè
// node thực thể, REL/ALIAS_OF/tài liệu kề chỉ thêm khi chưa có — `setdefault`).
import type {
  CorpusRow,
  Graph,
  GraphLink,
  GraphNode,
  NbRow,
  NbRowKind,
} from "../application/graph.ports";

export const GRAPH_LIMITS = {
  keysMax: 200,
  keyMax: 300,
  excludeMax: 2000,
  expandDefault: 20,
  expandMax: 200,
  similarDefault: 200,
  similarMax: 500,
  corpusDefault: 300,
  corpusMax: 1000,
  conflictsDefault: 100,
  conflictsMax: 500,
  linksBatchMax: 1000,
  urisMax: 500,
  chunksMax: 2000,
  perChunkMax: 200,
} as const;

export type GraphError =
  | "ID_INVALID"
  | "KEY_INVALID"
  | "TOO_MANY"
  | "LINK_INVALID"
  | "ENTITY_INVALID";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/** Số nguyên trong [lo, hi]; vắng/sai ⇒ `def`. */
export function clampInt(v: unknown, lo: number, hi: number, def: number): number {
  const n = typeof v === "number" ? v : v === undefined || v === null || v === "" ? NaN : Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

export const validKey = (k: unknown): k is string =>
  typeof k === "string" && k.trim() !== "" && k.length <= GRAPH_LIMITS.keyMax;

export function checkKeys(keys: readonly unknown[]): GraphError | null {
  if (keys.length > GRAPH_LIMITS.keysMax) return "TOO_MANY";
  return keys.every(validKey) ? null : "KEY_INVALID";
}

export function checkIds(ids: readonly unknown[], max: number): GraphError | null {
  if (ids.length > max) return "TOO_MANY";
  return ids.every(isUuid) ? null : "ID_INVALID";
}

/** Thứ tự xử lý của mgmt-app: tài liệu → MENTIONS → REL → ALIAS_OF → tài liệu kề (SIMILAR/CONFLICTS rồi LINKS_TO). */
const ORDER: Record<NbRowKind, number> = { doc: 0, mention: 1, rel: 2, alias: 3, doclink: 4 };
const DOCLINK_ORDER: Record<string, number> = { SIMILAR: 0, CONFLICTS: 0, LINKS_TO: 1 };

export function toNeighbourhood(docId: string, rows: readonly NbRow[]): Graph {
  const sorted = [...rows].sort(
    (x, y) =>
      ORDER[x.row] - ORDER[y.row] ||
      (DOCLINK_ORDER[x.ltype ?? ""] ?? 0) - (DOCLINK_ORDER[y.ltype ?? ""] ?? 0),
  );
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const keep = (id: string, label: string, type: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, label, type });
  };
  for (const r of sorted) {
    if (r.row === "doc") {
      nodes.set(r.src, { id: r.src, label: r.label, type: "Document" });
      continue;
    }
    if (r.dst === null) continue;
    if (r.row === "mention") nodes.set(r.dst, { id: r.dst, label: r.label, type: r.ntype });
    else keep(r.dst, r.label, r.ntype);
    const source = r.row === "doclink" || r.row === "mention" ? docId : r.src;
    links.push({ source, target: r.dst, type: r.ltype ?? r.row.toUpperCase() });
  }
  return { nodes: [...nodes.values()], links };
}

/** Kho toàn tenant: node = tài liệu (không phải hợp đồng); cạnh SIMILAR/CONFLICTS (đếm cặp), LINKS_TO, SHARES (≥ min). */
export function toCorpus(rows: readonly CorpusRow[]): Graph {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const rank: Record<CorpusRow["row"], number> = { node: 0, pair: 1, link: 2, shares: 3 };
  const sorted = [...rows].sort((x, y) => rank[x.row] - rank[y.row]);
  for (const r of sorted) {
    if (r.row === "node") nodes.push({ id: r.a, label: r.label ?? "", type: "Document" });
    else if (r.b !== null) links.push({ source: r.a, target: r.b, type: r.type, n: r.n });
  }
  return { nodes, links };
}
