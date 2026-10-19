---
id: N4-knowledge
title: N4 · Dịch vụ tri thức (gộp 2 RAG, ADR-0021) — eval 0.11 + module hub-api
status: on-hold  # 2026-10-19 người dùng cho dừng đợt; trạng thái dưới đây
requirements: [N4-FR-01, N4-FR-02, N4-FR-03, N4-FR-04, N4-FR-05, N4-FR-06, N4-FR-07, N4-NFR-01]
---

# N4 · tasks (trạng thái khi dừng 2026-10-19)

Làn: **đầy đủ** cho phần RLS/tenant (test RLS viết trước code repo), **nhanh** cho phần còn lại. Chưa có spec.md/plan.md riêng
(phạm vi lấy từ brief CR-094 đợt 3 + ADR-0021); viết khi mở lại.

## Đã xong
| # | Việc | Nơi |
|---|---|---|
| T1 | Schema `knowledge` theo khuôn gói N1 (`packs.install`, role `knowledge_rw`, RLS FORCE, FK kép tenant): `documents`, `chunks` (`tsv` sinh: `knowledge.fold` = unaccent+lower TRƯỚC parser, cấu hình `knowledge.vi`), `chunk_embeddings` (`real[]`); 0002: GIN (tenant_id, tsv) qua btree_gin | `packages/db/migrations-pack-knowledge/`, `PACK_DIRS` |
| T2 | Bộ RLS TK1 `defineRlsSuite` (5 bảng) — 26 pass | `tests/acceptance/N4/rls.int.test.ts` |
| T3 | Module `apps/hub-api/src/modules/knowledge` (domain/application/adapters): chia đoạn port mgmt-app (`chunk.py`, `contracts/chunk.py`, ngân sách ký tự), ngữ cảnh tài liệu gắn mỗi đoạn, `RetrievalStrategy` (c) `fts` BM25-lite / (a) `embedding` hybrid RRF, `Embedder` OpenAI + `Reranker` Claude gắn theo key | `knowledge.mount.ts` |
| T4 | Tool MCP `knowledge-search/get/add` (registry gói N2 chỉ nhận `<pack>-<tên>` ⇒ không dùng dấu chấm), quyền read/read/write, nối ở `mountPacks` | `adapters/knowledge.tools.ts` |
| T5 | Int: cách ly tenant (canary B không lộ), thăm dò id chéo ≡ không có, thiếu/sai tenant ⇒ `TENANT_INVALID`, 2 câu SQL/lần tìm — 8 pass; unit 23 pass | `tests/acceptance/N4/search.int.test.ts` |
| T6 | Eval 0.11: 90 câu tiếng Việt (fact 25, clause 20, number/date 21, multi-hop 15, no-answer 9) trên 29 tài liệu (12 HĐ mgmt-app + 11 ADR thay kho KnowledgeHub + 5 nhiễu EN + 1 canary tenant B); harness recall@k, MRR, phủ ý, rò rỉ, p95, chấm rubric (Claude API hoặc fixture offline) | `eval/n4-knowledge/` |

## Số đo (seed 42, 5 lượt × 90 câu, máy 12 luồng đang chạy lát khác, CPU máy 20–60% lúc đo)
| Biến thể | R@1 | R@3 | R@5 | R@10 | MRR | phủ ý@5 | p95 |
|---|---|---|---|---|---|---|---|
| **(c) fts** (IDF, không bigram, có ngữ cảnh) | 0,708 | 0,901 | 0,944 | 0,981 | 0,865 | 0,949 | 4,8 ms |
| fts-plain (OR + ts_rank, không IDF) | 0,436 | 0,772 | 0,833 | 0,907 | 0,655 | 0,854 | 2,3 ms |
| fts-bigram (w 1,5) | 0,733 | 0,858 | 0,901 | 0,963 | 0,863 | 0,905 | 6,8 ms |
| fts-noctx (không ngữ cảnh tài liệu) | 0,547 | 0,759 | 0,827 | 0,920 | 0,711 | 0,862 | 5,3 ms |
| (a) embedding / rerank Claude | **chờ key** (không có OPENAI_API_KEY / ANTHROPIC_API_KEY — không gọi API) | | | | | | |
- Chấm đáp án: OFFLINE, Claude (tác nhân N4) tự chấm top-5 theo RUBRIC, ghi `judgments.offline.json` — **0,944** (90/90, bản truy vấn trước khi chặn trần ứng viên); với SQL hiện tại 58/90 trùng chữ ký ⇒ 0,957 trên 58, **32 câu chưa chấm lại**.
- Rò rỉ chéo tenant: 0 ở mọi biến thể. Baseline mgmt-app RAG và KnowledgeHub: **không đo được** (cần OPENAI_API_KEY + OpenSearch; KH không có trên máy).
- Perf 10.000 đoạn/tenant (`tests/acceptance/N4/perf/search.perf.int.test.ts`, PERF=1): kho zipf p95 **297 ms — CHƯA ĐẠT** ≤ 50 ms (đánh dấu `it.failing`); kho đều (ca xấu) p95 85 ms. Nguyên nhân đo được: câu chuẩn bị của pool (`createDb` prepare) dùng generic plan ⇒ đếm df dò cả tenant + `@@` từng hàng; cùng câu không chuẩn bị chạy ~5 ms.

## Còn lại
1. Perf: ép custom plan cho câu tìm (vd `plan_cache_mode` cục bộ tx hoặc câu không chuẩn bị) rồi đo lại tới ≤ 50 ms; bỏ `it.failing`.
2. Chấm lại 32 câu có top-5 đổi; (a) + rerank khi có key: `bun --env-file=.env.local eval/n4-knowledge/run.ts --variant embedding|fts+rerank`.
3. Đo baseline mgmt-app (cần key + OpenSearch) để chốt tiêu chí "≥ cả hai RAG" (ADR-0021).
4. spec.md/plan.md, review + security review (lát chạm RLS), qc ghi lock `tests/acceptance/N4/**`.
5. Nợ: pgvector cho (a) (đang `real[]` quét tuần tự); lọc theo quyền tài liệu (ADR-0021 §2) chưa làm — mới cách ly tenant; xoá/tái chỉ mục tài liệu; FileBox cho file gốc.

## Quyết định trong lúc làm
- Dịch vụ tri thức dùng khuôn gói (`packs.install('knowledge')`) để có role/RLS/`defineRlsSuite` sẵn — đăng ký trong `PACK_DIRS` dù không phải gói nghiệp vụ.
- Bigram mặc định tắt (đo: R@5 0,901 bật < 0,944 tắt). Ngữ cảnh tài liệu bật (R@5 0,827 → 0,944).
- `knowledge-add` không side_effect (ghi tri thức nội bộ tenant, khuôn `pkdemo-touch`), cần quyền `write`.
