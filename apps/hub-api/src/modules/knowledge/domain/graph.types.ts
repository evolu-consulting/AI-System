// G1 · CR-095: hình dạng dữ liệu thuần của đồ thị tri thức (domain không import application — depcruise
// `ca-domain-builtin-only`). `application/graph.ports.ts` re-export các kiểu này.

/** Hàng thô của `neighbourhood` (một câu SQL); `toNeighbourhood` dựng nodes/links như mgmt-app. */
export type NbRowKind = "doc" | "mention" | "rel" | "alias" | "doclink";
export type NbRow = {
  row: NbRowKind;
  src: string;
  dst: string | null;
  label: string;
  ntype: string;
  ltype: string | null;
};

export type CorpusRowKind = "node" | "pair" | "link" | "shares";
export type CorpusRow = {
  row: CorpusRowKind;
  a: string;
  b: string | null;
  label: string | null;
  type: string;
  n: number;
};

export type GraphNode = { id: string; label: string; type: string };
export type GraphLink = { source: string; target: string; type: string; n?: number };
export type Graph = { nodes: GraphNode[]; links: GraphLink[] };
