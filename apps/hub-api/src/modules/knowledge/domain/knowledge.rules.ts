// N4-FR-04 · N4-FR-06 · giới hạn + kiểm đầu vào của `knowledge.search/get/add` (thuần). Lỗi = mã ổn định, không ném.
import type { DocKind } from "./chunk.rules";

export const LIMITS = {
  queryMax: 1000,
  kDefault: 5,
  kMax: 20,
  titleMax: 300,
  contentMax: 500_000,
  chunksMax: 2000,
  uriMax: 1000,
  /** Ứng viên FTS trước rerank. */
  candidates: 30,
  /** Ký tự thân đoạn trả qua MCP mỗi hit (ngân sách ngữ cảnh agent). */
  hitChars: 1500,
} as const;

export type KnowledgeError =
  | "QUERY_EMPTY"
  | "QUERY_TOO_LONG"
  | "TITLE_INVALID"
  | "CONTENT_EMPTY"
  | "CONTENT_TOO_LARGE"
  | "TOO_MANY_CHUNKS"
  | "KIND_INVALID"
  | "URI_INVALID"
  | "ID_INVALID";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function checkQuery(q: string): KnowledgeError | null {
  const s = q.trim();
  if (s === "") return "QUERY_EMPTY";
  if (s.length > LIMITS.queryMax) return "QUERY_TOO_LONG";
  return null;
}

/** k ngoài [1, kMax] hoặc không nguyên ⇒ kẹp; vắng ⇒ mặc định. */
export function clampK(k: unknown): number {
  const n = typeof k === "number" ? k : Number(k);
  if (!Number.isFinite(n)) return LIMITS.kDefault;
  return Math.min(LIMITS.kMax, Math.max(1, Math.trunc(n)));
}

export type AddInput = { title: string; content: string; kind?: string; uri?: string | null };

export function checkAdd(i: AddInput): KnowledgeError | null {
  const t = i.title.trim();
  if (t === "" || t.length > LIMITS.titleMax) return "TITLE_INVALID";
  if (i.content.trim() === "") return "CONTENT_EMPTY";
  if (i.content.length > LIMITS.contentMax) return "CONTENT_TOO_LARGE";
  if (i.kind !== undefined && i.kind !== "markdown" && i.kind !== "contract") return "KIND_INVALID";
  if (i.uri != null && (i.uri.length > LIMITS.uriMax || /[\s<>]/.test(i.uri))) return "URI_INVALID";
  return null;
}

export const kindOf = (k: string | undefined): DocKind =>
  k === "contract" ? "contract" : "markdown";
export const isUuid = (s: string): boolean => UUID.test(s);

/** Nối điểm hạng hai danh sách (Reciprocal Rank Fusion, k = 60) — hybrid như OpenSearch hybrid của mgmt-app. */
export function rrf<T extends { chunkId: string }>(lists: readonly (readonly T[])[], k = 60): T[] {
  const score = new Map<string, number>();
  const first = new Map<string, T>();
  for (const list of lists)
    list.forEach((h, i) => {
      score.set(h.chunkId, (score.get(h.chunkId) ?? 0) + 1 / (k + i + 1));
      if (!first.has(h.chunkId)) first.set(h.chunkId, h);
    });
  return [...first.values()].sort(
    (a, b) =>
      (score.get(b.chunkId) ?? 0) - (score.get(a.chunkId) ?? 0) ||
      a.chunkId.localeCompare(b.chunkId),
  );
}
