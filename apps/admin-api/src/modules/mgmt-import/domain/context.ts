// I1 · ảnh chụp nguồn (đã đọc hết, chỉ-đọc) + ngữ cảnh phân giải tenant/user cho mapper. Thuần.
import { targetId } from "./ids.rules";
import type { Issue } from "./values.rules";

/** Một bản ghi OpenSearch: `_id` + `_source` (đã bỏ `embedding`). */
export type SourceDoc = { id: string; src: Record<string, unknown> };

export type GraphKey =
  | "entities"
  | "mentions"
  | "rels"
  | "aliases"
  | "chunk_links"
  | "doc_links"
  | "doc_chunks"
  | "contract_graph";

export type Snapshot = {
  docs: Record<string, SourceDoc[]>;
  graph: Partial<Record<GraphKey, unknown[][]>>;
};

export type Ctx = {
  /** Instance nguồn (vd `mgmt-prod`) — vào id tất định và marker tenant. */
  source: string;
  /** org mgmt ⇒ tenant đích (đã nhập bởi N5) hoặc null. */
  tenantOf(orgId: string | null | undefined): string | null;
  /** (tenant, email thường) ⇒ user đích hoặc null. */
  userOf(tenantId: string, email: string | null | undefined): string | null;
  /** User dự phòng cho cột NOT NULL `created_by` (chủ tổ chức, hoặc actor nhập). */
  fallbackUser(tenantId: string): string;
  /** org của tài liệu tri thức chung (domain=general) — mgmt-app không gắn org cho chúng. null ⇒ không chuyển. */
  knowledgeOrg: string | null;
  issues: Issue[];
};

export const docsOf = (s: Snapshot, index: string): SourceDoc[] => s.docs[index] ?? [];

/** Id đích tất định của bản ghi mgmt. */
export const idOf = (ctx: Ctx, kind: string, mgmtId: string): string =>
  targetId(ctx.source, kind, mgmtId);
