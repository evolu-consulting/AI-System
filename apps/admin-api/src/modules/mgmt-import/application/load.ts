// I1 · đọc toàn bộ nguồn (chỉ-đọc) vào ảnh chụp: mọi index mgmt-app cần cho mapper + truy vấn đồ thị. Quy mô mgmt-app (≤ 10.000
// HĐ mỗi org — giới hạn của chính mgmt-app) vừa bộ nhớ; đọc theo lô scroll, không giữ embedding.
import type { GraphKey, Snapshot } from "../domain/context";
import type { SourceReader } from "./ports";

export const INDICES = [
  "orgs",
  "users",
  "memberships",
  "contracts",
  "catalogs",
  "companies",
  "state",
  "obligations",
  "partner_events",
  "cks_lots",
  "cks_certificates",
  "cks_renewals",
  "signed_docs",
  "market_observations",
  "followups",
  "notifications",
  "feedback",
  "quotes",
  "score_configs",
  "score_config_history",
  "score_snapshots",
  "market_scans",
  "chat_files",
  "chats",
  "documents",
  "chunks",
] as const;

/** Index nguồn KHÔNG chuyển (vận hành: phiên đăng nhập, nhật ký, đo dùng, vector thực thể). */
export const NOT_MIGRATED = ["sessions", "events", "app_logs", "llm_usage", "entities"] as const;

export const GRAPH_KEYS: readonly GraphKey[] = [
  "entities",
  "mentions",
  "rels",
  "aliases",
  "chunk_links",
  "doc_links",
  "doc_chunks",
  "contract_graph",
];

export async function loadSnapshot(
  r: SourceReader,
  batch: number,
  withGraph: boolean,
): Promise<Snapshot> {
  const s: Snapshot = { docs: {}, graph: {} };
  for (const ix of INDICES) {
    const list: Snapshot["docs"][string] = [];
    for await (const page of r.scan(ix, batch)) list.push(...page);
    s.docs[ix] = list;
  }
  if (!withGraph) return s;
  for (const q of GRAPH_KEYS) {
    const rows: unknown[][] = [];
    for await (const page of r.graph(q, batch)) rows.push(...page);
    s.graph[q] = rows;
  }
  return s;
}
