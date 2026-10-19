---
id: R1-rag
title: R1 · Một RAG gộp — perf tìm, pool/role riêng, nạp tài liệu mgmt-app, liên kết KnowledgeHub, rerank
status: in-progress
requirements: [N4-FR-02, N4-FR-03, N4-FR-05, N4-NFR-01]
---

# R1 · tasks (Luật 0b — lát nhanh, một agent)

**Migration:** `migrations-pack-knowledge/0004_r1_lexemes_role.sql` (G1 giữ 0003 `0003_graph`, đã merge trước). `when` của 0004
(1794900300000) lớn hơn của 0003 ⇒ thứ tự áp đúng. Thêm `migrations-hub-dev/0001_knowledge_login_dev.sql` (role dev).

| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| a | Perf `knowledge-search` 10k đoạn p95 ≤ 50 ms | đầy đủ (RLS + đường nóng) | xong |
| b | Pool + DSN riêng (`KNOWLEDGE_DATABASE_URL`), role `knowledge_api` chỉ SET ROLE `knowledge_rw` | đầy đủ (role) | xong |
| c | Nạp tài liệu (parse DOCX qua worker ADR-0024, chia đoạn, trích thực thể) | nhanh | đang làm |
| d | Liên kết KnowledgeHub (`KhClient` của `kh`, cờ env, giả trong test) + gộp RRF | nhanh | đang làm |
| e | Rerank Claude theo cấu hình (port `Reranker`, M3 chưa merge client AI chung) | nhanh | có sẵn từ N4, nối vào tập gộp |

## Quyết định trong lúc làm
- **Perf — nguyên nhân thật không phải generic plan.** Đo cục bộ (kho zipf 10k/tenant): p95 377 ms; ép `plan_cache_mode=force_custom_plan` vẫn 349 ms. EXPLAIN: (1) đếm df mỗi term quét `@@` từng hàng (planner không biết tsquery sinh trong câu); (2) dưới RLS `@@` (ts_match_vq) **không leakproof** ⇒ không được làm điều kiện chỉ mục ⇒ GIN (tenant_id, tsv) chỉ dò theo tenant. Sửa: bảng df `knowledge.lexemes` (trigger mức câu, bảng chuyển tiếp, khoá theo thứ tự lexeme) + hàm `knowledge.search_idf` (pha 2 `EXECUTE … USING` ⇒ kế hoạch với tsquery thật) chạy **SECURITY DEFINER** dưới role `knowledge_search` (NOLOGIN, NOBYPASSRLS, chỉ SELECT 3 bảng, policy đọc `true` chỉ cho role này). Tenant chỉ lấy từ `app.tenant_id` của tx (không tham số), `search_path` ghim, chỉ `knowledge_rw` EXECUTE. Cục bộ: 377 → 104 (df) → 72 (giải nén tsv 1 lần) → 49 (LATERAL, bỏ sort hàng rộng) → **28 ms** (DEFINER ⇒ GIN). **Cần security review cuối đợt.**
- Ngữ nghĩa xếp hạng giữ nguyên N4 (IDF có trần N/5, ứng viên ≤ 1000, Σ idf·(0,5+ts_rank)); df cụm nhiều lexeme = min df (cận trên).
- Pool riêng: server truyền `packs.knowledgeDsn` = `KNOWLEDGE_DATABASE_URL ‖ HUB_DATABASE_URL`; `createApp` trong test không truyền ⇒ dùng pool chung (không trỏ nhầm DB dev). Pool ≤ `KNOWLEDGE_DB_POOL_MAX` (mặc định 4), đóng theo `signal`. Production: vận hành đặt `ALTER ROLE knowledge_api LOGIN PASSWORD …` rồi trỏ `KNOWLEDGE_DATABASE_URL`.
- KH là kho DÙNG CHUNG (khoá nền tảng) ⇒ chỉ tenant trong `KNOWLEDGE_KH_TENANTS` (uuid,… hoặc `*`) mới hỏi KH; vắng ⇒ không ai. Thiếu URL/key/project ⇒ tắt, không gọi mạng.
- Gộp: có nguồn ngoài trả hit ⇒ RRF(nội bộ, KH) rồi rerank Claude nếu có key; không ⇒ thứ tự FTS như N4. Nguồn lỗi ⇒ log `knowledge-source-failed`, vẫn trả nội bộ.
- **PDF:** người dùng giao "PDF qua thư viện đã có trong repo" — repo không có (mgmt-app dùng docling/pypdfium2, Python). Điều phối đề xuất `unpdf@1.8.1` (2026-08-13, 0 phụ thuộc, 2,2 MB); lệnh `bun add` bị hệ thống quyền chặn ⇒ cổng `PdfText` trả `PDF_UNSUPPORTED`, PDF scan ⇒ `NEEDS_OCR` (OCR ngoài phạm vi). Bật: cài `unpdf` + adapter worker + ADR.

## Còn lại
- (điền khi đóng lát)
