# r1c-fixes — sửa review CR-095 đợt C (R1, G1) + review B #1

Nguồn: `docs/reviews/cr095-wave-C.md` (F-01, F-03, F-05..F-10, check:fn), `docs/reviews/cr095-wave-B.md` #1.

| Mã | Làn | Việc | Trạng thái |
|---|---|---|---|
| F-01 | nhanh | Kiểu dữ liệu đồ thị sang `domain/graph.types.ts`; `graph.ports` re-export (depcruise xanh) | xong |
| F-03 | đầy đủ (khoá) | Test trước (`R1/lexemes-lock.int.test.ts`, đỏ: 40P01) → migration `migrations-pack-knowledge/0005_r1_lexemes_lock_order.sql`: `lexemes_sub` khoá `ORDER BY tenant_id, lexeme FOR UPDATE` trước UPDATE | xong |
| F-05 | nhanh | `fitContent`: văn bản chuyển đổi > `contentMax` ⇒ cắt ở ranh giới đoạn + cảnh báo `truncated`; `IngestError` gồm mã của `addDocument` | xong |
| F-06 | nhanh | Nạp lại tài liệu trùng chưa có đồ thị (`IngestReadRepo.hasGraph`) ⇒ dựng lại; `GraphReport.failed`; addLinks lỗi ⇒ không báo số cạnh | xong |
| F-07 | đầy đủ (usage/trần) | Rerank + LLM đồ thị qua AI client chung (`clientAsk`, feature `knowledge.rerank` / `knowledge.graph`, tenant + người); bỏ `fetch` thẳng tới Anthropic; CLI ingest dùng pool Hub cho usage | xong |
| F-08 | nhanh | `aliasTries` (Map, ≤ 30 lần thử) + `aliasedPairs` một câu thay `hasAlias` từng cặp; LLM song song có giới hạn (`mapLimit`), cả phán mâu thuẫn | xong |
| F-09 | nhanh | KH mặc định 800 ms (200–30000) + `withBreaker` (3 lỗi ⇒ bỏ KH 30 s) | xong |
| F-10 | nhanh | Trần `nbSql` (thực thể 200, cạnh 500, tài liệu kề 200) và `corpus` (100 tài liệu/thực thể khi đếm SHARES, node 2000, mỗi loại cạnh ≤ limit); perf lệch `G1/perf/graph-skew.perf.int.test.ts` | xong |
| B#1 | nhanh | `migrate-hub.int.test.ts` đếm hub-dev theo journal | xong |
| fn | nhanh | Tách `graphRepo`, `graphUsecases`, `knowledgeRepo`, `knowledgeTools`, describe > 50 dòng, tham số > 4 | xong |

## Quyết định trong lúc làm
- F-05: cắt (cảnh báo `truncated`) thay vì chia tài liệu thành nhiều phần — giữ một tài liệu = một hash; bộ chuyển của bộ khung gói (5 M) không đổi vì gói khác dùng chung.
- F-06: không thể chung một tx (LLM ngoài tx); "chưa có đồ thị" = không MENTIONS, không SIMILAR/CONFLICTS, không LINKS_TO đi ra. Đồ thị thiếu một phần (vd chỉ bước similar lỗi) không tự sửa — ghi ở `failed`.
- F-07: embedding OpenAI chưa có trong AI client chung (chỉ Messages) — giữ fetch riêng, chỉ bật khi `KNOWLEDGE_STRATEGY=embedding`. Eval dùng client chung với kho usage rỗng.
- F-10: chọn tài liệu trong trần theo `doc_id` (tất định), không theo độ liên quan.

## Số đo (evotest)
- F-03: trước 4+ tx 40P01 / 12 lượt; sau 0, file 3,5 s.
- F-10 lệch (5.000 tài liệu nhắc 1 thực thể): neighbourhood p95 16,6 ms (cạnh 1.002); corpus p95 53,6 ms (2.000 node, 1.000 SHARES). Bộ G1 cũ: neighbourhood p95 6,5 ms, similar 1,7 ms.

## Còn lại
- F-04 (df = 0 không xoá, UPDATE tsv), F-17, F-18, F-19, F-20 — ngoài phạm vi lát này.
