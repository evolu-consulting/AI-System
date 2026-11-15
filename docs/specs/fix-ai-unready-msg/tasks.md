---
slice: fix-ai-unready-msg
lane: nhanh (không chạm RLS/quyền/tiền/migration)
---
# fix-ai-unready-msg · AI chưa sẵn sàng ⇒ nói đúng lý do

Staging 2026-11-15: tải HĐ lên báo «AI đọc quá lâu» trong khi AI hoàn toàn chưa có (hub-api không có Claude CLI / chưa đăng nhập).
Nguyên nhân: `extractJobs` khi `ready=false` là no-op ⇒ HĐ kẹt `extracting` tới vòng quét STALE (timeout sai lý do).

## Làm trong lát
- `extraction.mount.ts`: `ready=false` ⇒ `enqueue` chạy `down` = cùng `createRunExtraction` với `unavailableAgent` (adapters/ai-unavailable.ts)
  ⇒ đường `saveFailure` sẵn có ghi `extract_failed AGENT_UNAVAILABLE` ngay + đóng lượt đọc. Log `contracts-extraction-ai-not-ready` lúc khởi động.
- Web: `lib/fail-reason.ts` ánh xạ mã ⇒ khoá; `AGENT_UNAVAILABLE` ⇒ `failReason.aiDown` (trước đây nhầm là «định dạng chưa hỗ trợ»); vi + en.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Lý do không đọc được hợp đồng
Khối "Không đọc được hợp đồng này" nêu lý do nghiệp vụ (tệp hỏng / quá lớn / định dạng chưa hỗ trợ / hết lượt AI / AI đang tạm ngưng) kèm gợi ý "Nhập tay". Khi AI chưa cấu hình trên máy chủ, lượt đọc kết thúc ngay với mã AGENT_UNAVAILABLE (không chờ vòng quét STALE); câu «AI đang tạm ngưng…» khuyên "Thử lại" sau ít phút hoặc "Nhập tay", và báo quản trị nếu vẫn lỗi. Timeout thật giữ câu cũ.
- Kịch bản: khi AI chưa cấu hình và người dùng tải hợp đồng lên thì hợp đồng sang đọc-lỗi AGENT_UNAVAILABLE ngay, không chờ quét STALE [test: apps/hub-api/src/modules/packs/contracts/application/extraction-ai-unready.test.ts » enqueue khi ready=false]
- Kịch bản: khi mã lỗi là AGENT_UNAVAILABLE thì trang rà soát hiện câu «AI đang tạm ngưng…», còn TIMEOUT giữ câu «AI đọc quá lâu» [test: apps/workspace-web/src/features/contract-review/lib/fail-reason.test.ts » AGENT_UNAVAILABLE]

## Quyết định trong lúc làm
- Dùng lại `createRunExtraction` + agent giả trả `AGENT_UNAVAILABLE` thay vì thêm trạng thái/đường ghi mới.
- Không đụng đường "Trích lại": `flowRequestExtract` đã trả 503 `AGENT_UNAVAILABLE` khi chưa sẵn sàng (UI đã có khoá `aiUnavailable`).
