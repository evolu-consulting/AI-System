-- N4-NFR-01 · Luật 4c: chỉ mục GIN hai cột (tenant_id, tsv) qua btree_gin — đo 10.000 đoạn/tenant: planner bỏ dò cả tenant
-- qua `chunks_tenant_idx` + kiểm `@@` từng hàng (p95 346 ms) để dò GIN theo đúng tenant (p50 ~5 ms). Thay `chunks_tsv_idx`.
CREATE EXTENSION IF NOT EXISTS btree_gin;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chunks_tenant_tsv_idx ON knowledge.chunks USING gin (tenant_id, tsv);
--> statement-breakpoint
DROP INDEX IF EXISTS knowledge.chunks_tsv_idx;
--> statement-breakpoint
-- Câu chuẩn bị (generic plan) vẫn chọn btree tenant + lọc `@@` từng hàng nếu còn chỉ mục này ⇒ bỏ; N lấy từ documents.
DROP INDEX IF EXISTS knowledge.chunks_tenant_idx;
