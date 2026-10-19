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
| c | Nạp tài liệu: parse (MD/TXT, DOCX worker ADR-0024, PDF worker ADR-0028), chia đoạn, CLI `apps/hub-api/scripts/knowledge-ingest.ts` | nhanh | xong |
| c2 | Bộ sinh đồ thị G1 (yêu cầu thêm của điều phối): trích thực thể (LLM qua port, giả trong test), bí danh, LINKS_TO, SIMILAR/CONFLICTS | nhanh | xong |
| d | Liên kết KnowledgeHub (`KhClient` của `kh`, cờ env, giả trong test) + gộp RRF | nhanh | xong |
| e | Rerank Claude theo cấu hình (port `Reranker`, M3 chưa merge client AI chung) | nhanh | xong (chạy trên tập gộp) |
| f | Eval 90 câu chạy lại; 32 câu chưa chấm được chấm OFFLINE (Claude Sonnet, nhãn rõ trong `judgments.offline.json`) | nhanh | xong |

## Số đo
| Đo | Trước | Sau |
|---|---|---|
| Perf 10k đoạn/tenant, kho zipf, p95 (cục bộ, máy dùng chung 12 luồng) | 377 ms (N4 báo 297) | 28–49 ms tuỳ tải máy (chi tiết ở dưới) |
| Perf evotest (`-Step perf`), kho zipf, p95 | 297 ms (N4) | 74 ms (bảng df + DEFINER), rồi **28,1 ms** (p50 25,3) sau `SET enable_seqscan = off` trong hàm (planner ước 5% ⇒ quét tuần tự) |
| Perf evotest, kho đều (ca xấu, chỉ ghi số), p95 | 85 ms (N4) | 14,8 ms |
| Eval fts 90 câu: R@1 / R@3 / R@5 / R@10 / MRR / phủ ý@5 | 0,708 / 0,901 / 0,944 / 0,981 / 0,865 / 0,949 | **y hệt** (xếp hạng giữ nguyên ngữ nghĩa) |
| Eval chấm đáp án (OFFLINE) | 0,957 trên 58/90 câu | **0,944 trên 90/90** (2 = 29, 1 = 1, 0 = 2 ở 32 câu mới: q17, q37 thiếu đoạn mp; q57 thiếu c3#1) |
| Eval độ trễ p95 (kho nhỏ 118 đoạn) | 4,8 ms | 3,9 ms |

## Quyết định trong lúc làm
- **Perf — nguyên nhân thật không phải generic plan.** Đo cục bộ (kho zipf 10k/tenant): p95 377 ms; ép `plan_cache_mode=force_custom_plan` vẫn 349 ms. EXPLAIN: (1) đếm df mỗi term quét `@@` từng hàng (planner không biết tsquery sinh trong câu); (2) dưới RLS `@@` (ts_match_vq) **không leakproof** ⇒ không được làm điều kiện chỉ mục ⇒ GIN (tenant_id, tsv) chỉ dò theo tenant. Sửa: bảng df `knowledge.lexemes` (trigger mức câu, bảng chuyển tiếp, khoá theo thứ tự lexeme) + hàm `knowledge.search_idf` (pha 2 `EXECUTE … USING` ⇒ kế hoạch với tsquery thật) chạy **SECURITY DEFINER** dưới role `knowledge_search` (NOLOGIN, NOBYPASSRLS, chỉ SELECT 3 bảng, policy đọc `true` chỉ cho role này). Tenant chỉ lấy từ `app.tenant_id` của tx (không tham số), `search_path` ghim, chỉ `knowledge_rw` EXECUTE. Cục bộ: 377 → 104 (df) → 72 (giải nén tsv 1 lần) → 49 (LATERAL, bỏ sort hàng rộng) → **28 ms** (DEFINER ⇒ GIN). **Cần security review cuối đợt.**
- Ngữ nghĩa xếp hạng giữ nguyên N4 (IDF có trần N/5, ứng viên ≤ 1000, Σ idf·(0,5+ts_rank)); df cụm nhiều lexeme = min df (cận trên).
- Pool riêng: server truyền `packs.knowledgeDsn` = `KNOWLEDGE_DATABASE_URL ‖ HUB_DATABASE_URL`; `createApp` trong test không truyền ⇒ dùng pool chung (không trỏ nhầm DB dev). Pool ≤ `KNOWLEDGE_DB_POOL_MAX` (mặc định 4), đóng theo `signal`. Production: vận hành đặt `ALTER ROLE knowledge_api LOGIN PASSWORD …` rồi trỏ `KNOWLEDGE_DATABASE_URL`.
- KH là kho DÙNG CHUNG (khoá nền tảng) ⇒ chỉ tenant trong `KNOWLEDGE_KH_TENANTS` (uuid,… hoặc `*`) mới hỏi KH; vắng ⇒ không ai. Thiếu URL/key/project ⇒ tắt, không gọi mạng.
- Gộp: có nguồn ngoài trả hit ⇒ RRF(nội bộ, KH) rồi rerank Claude nếu có key; không ⇒ thứ tự FTS như N4. Nguồn lỗi ⇒ log `knowledge-source-failed`, vẫn trả nội bộ.
- **PDF:** brief ban đầu là "PDF qua thư viện đã có trong repo", mà repo không có thư viện PDF nào (mgmt-app dùng docling/pypdfium2, Python). Người dùng duyệt `unpdf@1.8.1` (điều phối chuyển lời) và tự cài ⇒ ADR-0028. Bộ đọc nằm ở bộ khung gói (`packs/kit`), dùng lại được cho hợp đồng. PDF scan ⇒ `PDF_NEEDS_OCR`, OCR ngoài phạm vi.
- Nạp không có embedding (chưa có OPENAI key) nên thay hai bước của mgmt-app: ứng viên bí danh = cùng loại + cùng tập từ đã bỏ dấu (bỏ "nhóm/dự án/phòng/công ty" ở đầu tên), rồi LLM xác nhận; độ giống đoạn = cosine trên tập từ (ngưỡng 0,5), ứng viên lấy bằng một lần tìm FTS theo 12 từ đại diện của tài liệu. LLM phán CONFLICTS chỉ với cặp ≥ 0,7, tối đa 10 cặp mỗi tài liệu (trần chi phí). Hợp đồng không so giống (mgmt-app chỉ so hợp đồng với phụ lục của chính nó, quan hệ đó chưa có).
- LLM của đồ thị: `KNOWLEDGE_GRAPH_AI=on` + `ANTHROPIC_API_KEY` (gọi qua client `claudeText`; M3 chưa merge client chung) | `fake` (bản giả tất định như `fake_llm`) | trống = không trích thực thể (vẫn có LINKS_TO + SIMILAR).
- Số câu SQL mỗi tài liệu cố định: add 2, getDocument 1, attach (G1) 2, ứng viên bí danh 1, linkDocuments 1, tìm FTS 1, addLinks 1. Riêng addAlias là 1 câu mỗi cặp (cổng G1 theo cặp), trần 10.

## Còn lại
- Security review cuối đợt: hàm DEFINER `knowledge.search_idf` + role `knowledge_search` (policy đọc `true` chỉ cho role này) + role `knowledge_api`.
- Production: `ALTER ROLE knowledge_api WITH LOGIN PASSWORD …`, đặt `KNOWLEDGE_DATABASE_URL`. Bật KH: `KNOWLEDGE_KH_URL/KEY/PROJECT/TENANTS`. Bật rerank / đồ thị: `ANTHROPIC_API_KEY` + `KNOWLEDGE_RERANK=on` / `KNOWLEDGE_GRAPH_AI=on`. Biến thể embedding: `OPENAI_API_KEY`.
- Eval biến thể (a) embedding và fts+rerank vẫn chờ key. Baseline mgmt-app và KH thật chưa đo (cần key + OpenSearch + KH thật).
- Ứng viên bí danh (`ingest.repo.aliasCandidates`) lọc `@@` trên `knowledge.entities` dưới RLS, không dùng được chỉ mục: ổn khi ít thực thể, cần đo khi kho lớn.
- Còn đọng từ trước, không thuộc lát này: vi phạm depcruise của G1 (`domain/graph.rules.ts` → `application/graph.ports.ts`). `DocxQueue`/`PdfQueue` nên gộp (TECH-DEBT #236).
