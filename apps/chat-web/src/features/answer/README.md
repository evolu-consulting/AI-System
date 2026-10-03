# answer — thân câu trả lời (UC-03, UC-04 · CHAT-AC-08..13, 23..27)
Component trình bày, chỉ nhận props: `AnswerBody` (markdown lazy, ADR-0006; chunk chưa tới → chữ thô), `Markdown` + `CodeBlock` (`lib/highlight.ts`, hljs core chunk riêng, nút Copy), `StepList` (bước đang chạy → "✓ n bước"), `AskCard` (lựa chọn → gửi trong flow), `ErrorCard` (`lib/error-map.ts`: mã lỗi → câu VI/EN), `CancelledNote`, `ColdResumeNote`.
Dùng bởi `thread` (khối flow) và `flow-panel` (khung flow). Spinner/con trỏ có `motion-reduce:animate-none`.
