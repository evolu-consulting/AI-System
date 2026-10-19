# G1 — Đồ thị tri thức sang Postgres (bỏ Neo4j) · CR-095 · Luật 0b

| Làn | Lý do |
|---|---|
| Đầy đủ (phần RLS) + nhanh (phần còn lại) | Bảng mới trong schema có RLS ⇒ test RLS viết cùng bảng; đường đọc có ngưỡng perf |

## Plan (đã làm)
- Bảng trong `knowledge` (migration `migrations-pack-knowledge/0003_graph.sql`), RLS FORCE qua `packs.secure_table`.
  Document/Chunk/HAS_CHUNK = `documents`/`chunks` của N4. Mới: `entities` (key duy nhất trong tenant), `chunk_entities`
  (MENTIONS), `entity_aliases` (ALIAS_OF vô hướng, a_id < b_id), `entity_rels` (REL + đoạn làm chứng), `chunk_links`
  (SIMILAR/CONFLICTS, có hướng, mang sẵn `src_doc_id`/`dst_doc_id`), `document_links` (LINKS_TO).
  Mọi PK/index cạnh bắt đầu `tenant_id`, có index hai chiều; FK kép (id, tenant_id) ⇒ không thể nối cạnh chéo tenant; CASCADE theo tài liệu/đoạn.
- Cổng `knowledge/application/graph.ports.ts` + `graph.usecases.ts`; SQL `adapters/graph.repo.ts` + `graph.sql.ts`; luật thuần
  `domain/graph.rules.ts` (dựng nodes/links như mgmt-app). `graphService(db)` trong `knowledge.mount.ts` (uow riêng, cổng N4 không đổi).
- Tool MCP đọc `knowledge-similar`, `knowledge-graph` — đường duy nhất cho gói khác (contracts) đọc đồ thị; không join chéo schema.

## Ánh xạ câu Cypher → SQL (mỗi hàm số câu cố định)
| mgmt-app | G1 | Câu SQL |
|---|---|---|
| `upsert_document` (phần đồ thị) | `attach` | 2 (xoá MENTIONS cũ; CTE thực thể + MENTIONS + REL) |
| `link_documents` | `linkDocuments` | 1 |
| `expand` (ALIAS_OF*0..1) | `expand` | 1 |
| `has_alias` / `add_alias` | `hasAlias` / `addAlias` | 1 / 1 |
| `add_similar` / `add_conflict` | `addLinks` (theo lô) | 1 / lô |
| `similar_documents` | `similarDocuments` | 1 |
| `neighbourhood` (5 câu Cypher) | `neighbourhood` | 1 |
| `corpus` | `corpus` | 1 |
| `routes/stats.py` `_entities_stats` + `_links_stats` | `stats` | 1 |
| `routes/stats.py` `/conflicts` | `conflicts` | 1 |
| `delete_document`, `reset` | FK CASCADE / truncate | 0 |

## Quyết định trong lúc làm
- "Miền general" của mgmt-app = `documents.kind <> 'contract'` (corpus/stats/conflicts); `similar_documents` không lọc miền (như gốc).
- `attach` vào tài liệu không có/không thuộc tenant ⇒ không ghi gì (kể cả thực thể); quan hệ chỉ nối thực thể đã có.
- `similarDocuments` trần 500 dòng, `expand` ≤ 200, `corpus` ≤ 1000 cặp SHARES (gốc không trần) — Luật 4c.
- Phần chiếu hợp đồng của mgmt-app (`contracts/project.py`, `products.py`, `tools.py` find_contracts/price_history/
  amendments/effective_lines, nút Party/Product/PriceLine/SUPERSEDES/AMENDS) **không** chuyển vào đồ thị: gói contracts đã
  lưu quan hệ (`contracts.contracts.parent_id`, `contract_items`, giá phụ lục tính khi đọc — D-HD5-01). `migrate_orgs.py`,
  dọn nút Party/Product mồ côi (`routes/companies.py`, `routes/products.py`, `seed/purge.py`) không còn nghĩa (org = tenant, FK chặn cạnh chéo).
- contracts-web chưa có màn nào cần đồ thị (HD8 chưa bắt đầu) ⇒ chỉ mở tool MCP, chưa nối màn.

## Số đo (evotest, 10.000 tài liệu / 100.000 đoạn / 300k MENTIONS / 55k SIMILAR+CONFLICTS mỗi tenant × 2)
- neighbourhood p95 4,2 ms (p50 2,5) · similar_documents p95 1,8 ms · expand (50 thực thể nhắc nhiều nhất) p95 1,7 ms.
- stats p95 107 ms (trước khi bỏ `count(distinct record)`: stats+conflicts 415 ms) · conflicts p95 116 ms — toàn tenant, chỉ ghi số.
- Số câu: neighbourhood/similar = set_config + 1; EXPLAIN không Seq Scan trên bảng đồ thị.

## Còn lại
- Bên ghi đồ thị chưa có ở platform: trích thực thể (LLM, `ingest/pipeline.py`), job SIMILAR/CONFLICTS (`query/similar.py`),
  gộp bí danh (`ingest/resolve.py`) — cổng ghi đã sẵn (`attach`, `addLinks`, `addAlias`).
- `corpus` SHARES tự join (tài liệu, thực thể) — bùng nổ với thực thể rất phổ biến (ghi chú "ponytail" của gốc); chưa đo ở 10k.
  Cần bảng đếm cặp vật chất hoá nếu màn kho đồ thị dùng thật.
- Chuyển dữ liệu Neo4j thật → bảng (thuộc lát nhập dữ liệu).
