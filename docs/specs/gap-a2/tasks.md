# gap-a2 · Văn bản gốc + Hỏi về hợp đồng này (làn nhanh)

Nguồn: audit gap #3 (Văn bản gốc, "Xem đoạn này trong văn bản gốc"), #6 ("Hỏi về hợp đồng này") so với mgmt-app `contracts/[id]`.

## Quyết định
- BE giữ nguyên: `GET /pack/contracts/contracts/:id/source` đã có (RLS gói ⇒ chỉ người thấy HĐ, 404 giống id lạ). Chỉ thêm int chặn đọc khi không thấy (chế độ org).
- #3 FE: `features/contract-source` — `locateQuote` (chuẩn hoá hoa/thường, xuống dòng, dấu Markdown, "…") + `SourcePanel` (khoang phải, `<mark>` + scrollIntoView) + `QuoteLine` (nút "Xem đoạn này…" qua `SourceViewerContext`, chỉ có khi `has_source`). Gắn vào trích dẫn trường (FieldsGrid) và mốc AI.
- #6: `AskContractPanel` dùng lại `ask()` của khoang trợ lý (cùng hội thoại Hub ⇒ nằm trong lịch sử chat), agent `assistant`, ngữ cảnh dock tự có entity HĐ từ URL; thêm `CONTRACT_QA_INSTRUCTION` (chỉ dựa vào HĐ này + trích dẫn) ghép trước câu hỏi trong `buildRequest`. Không agent mới, không migration.
- Chuỗi i18n thêm vào `assistant.{vi,en}.json` (tránh đụng `contracts-locales.ts` của lát song song).
- "Xem hợp đồng gốc" (file preview) thuộc lát feedback-original — không làm lại; nút "Văn bản gốc" ở đây là văn bản đã trích, khác tệp gốc.

## Test
- unit `contract-source/lib/quote.test.ts`, `assistant/lib/chat.rules.test.ts` (ca mới)
- int `hub-api/.../adapters/source-visibility.int.test.ts`
- e2e (viết, chưa chạy) `e2e/contracts-web/gap-a2-source-ask.cw.ts`
