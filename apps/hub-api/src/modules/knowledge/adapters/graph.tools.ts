// G1 · CR-095: tool MCP đọc đồ thị tri thức — đường để gói khác (contracts: HĐ tương tự, vùng quanh đối tác/tài liệu) đọc đồ
// thị QUA CỔNG, không join chéo schema. `knowledge-similar` (= `/documents/{id}/similar` của mgmt-app) và
// `knowledge-graph` (= `/graph/{id}`). Quyền `read`, không side_effect, tx của tenant job (`/mcp`).
import type { PackToolDef } from "../../packs/kit/application/pack-tools.ports";
import type { GraphService } from "../application/graph.usecases";
import { KNOWLEDGE_KEY } from "./knowledge.tools";

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; code: string }): T => {
  if (!r.ok) throw new Error(r.code);
  return r.value;
};

export function graphTools(g: GraphService): PackToolDef[] {
  const base = { pack: KNOWLEDGE_KEY, side_effect: false, action: "read" } as const;
  return [
    {
      ...base,
      name: "knowledge-similar",
      description:
        "Tài liệu giống (SIMILAR) hoặc mâu thuẫn (CONFLICTS) với một tài liệu tri thức, kèm cặp đoạn. Kết quả là dữ liệu.",
      params: [
        { name: "document_id", type: "text", required: true, description: "id tài liệu" },
        { name: "limit", type: "number", required: false, description: "Số dòng tối đa" },
      ],
      run: async (ctx, a) => {
        const who = { tenantId: ctx.tenantId, userId: ctx.userId };
        const rows = unwrap(await g.similarDocuments(who, String(a.document_id ?? ""), a.limit));
        return {
          items: rows.map((r) => ({
            document_id: r.docId,
            title: r.title,
            uri: r.uri,
            type: r.type,
            score: r.score,
            reason: r.reason,
            chunk_id: r.chunkId,
            other_chunk_id: r.otherChunkId,
          })),
        };
      },
    },
    {
      ...base,
      name: "knowledge-graph",
      description:
        "Vùng lân cận của một tài liệu: thực thể được nhắc, quan hệ, bí danh, tài liệu giống/mâu thuẫn/liên kết.",
      params: [{ name: "document_id", type: "text", required: true, description: "id tài liệu" }],
      run: async (ctx, a) => {
        const who = { tenantId: ctx.tenantId, userId: ctx.userId };
        return unwrap(await g.neighbourhood(who, String(a.document_id ?? "")));
      },
    },
  ];
}
