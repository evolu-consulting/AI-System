// R1 · ADR-0021 §3 (gộp hai RAG): luật thuần cho tìm liên kết KnowledgeHub. Thân `POST /vector/query` của KH (giao thức K1 §3.0:
// `{hits: [{score, source_text, id?, title?, source?}]}`) ⇒ đoạn cùng dạng với đoạn nội bộ, id có tiền tố `kh:` (không trùng
// uuid nội bộ, `knowledge-get` không tra được — đúng ý: nội dung KH chỉ đọc qua tìm). Hit sai dạng bị bỏ. Không I/O.

export type FedHit = {
  chunkId: string;
  docId: string;
  title: string;
  heading: string;
  clauseNo: string | null;
  ord: number;
  body: string;
  score: number;
  source: string;
};

/** Trần ký tự thân một hit KH (bằng trần đoạn nội bộ). */
export const KH_HIT_MAX_CHARS = 8000;

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;

/** FNV-1a 32-bit — id ổn định cho hit KH không mang id (cùng nội dung ⇒ cùng id ⇒ RRF gộp được). */
export function stableId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Thân KH ⇒ đoạn sắp theo score giảm, tối đa `k`; thân không có mảng `hits` ⇒ []. */
export function parseKhHits(body: unknown, k: number, source = "kh"): FedHit[] {
  if (typeof body !== "object" || body === null) return [];
  const raw = (body as Record<string, unknown>).hits;
  if (!Array.isArray(raw)) return [];
  const out: FedHit[] = [];
  for (const h of raw) {
    if (typeof h !== "object" || h === null) continue;
    const r = h as Record<string, unknown>;
    const text = str(r.source_text, KH_HIT_MAX_CHARS);
    if (text === null || typeof r.score !== "number" || !Number.isFinite(r.score)) continue;
    const id = str(r.id, 200) ?? stableId(text);
    const title = str(r.title, 300) ?? str(r.source, 300) ?? "KnowledgeHub";
    out.push({
      chunkId: `${source}:${id}`,
      docId: `${source}:${str(r.source, 200) ?? id}`,
      title,
      heading: "",
      clauseNo: null,
      ord: 0,
      body: text,
      score: r.score,
      source,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, Math.max(0, k));
}
