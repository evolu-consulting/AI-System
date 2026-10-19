# ADR-0029 · AI client chung của Hub gọi Claude bằng `@anthropic-ai/sdk`

Trạng thái: **Accepted** (2026-10-20). Người dùng duyệt các lựa chọn được đề xuất trong chat ngày 2026-10-20; điều phối chuyển lại nguyên văn: "tôi nói set /goal làm cho xong, nếu có câu hỏi thì làm như recommend đi mà". Liên quan: lát M3-decouple (`docs/specs/M3-decouple/tasks.md`, M3-01…M3-03), ADR-0001 (pin chính xác), ADR-0019 (runtime AI), ADR-0028 (PDF).

## Bối cảnh
Gói hợp đồng không được phụ thuộc engine quy trình nữa. Lượt AI đọc hợp đồng trước đây chạy như job agent trong engine, nay phải gọi model trực tiếp từ một job của gói. Trợ lý chat sau này cũng sẽ dùng cùng đường. Cần một chỗ duy nhất để:
- ghi usage theo tenant (token, chi phí, model, tính năng),
- áp trần theo tenant,
- đọc khoá chỉ từ env/secret.

Repo chưa có thư viện gọi Claude nào ở phía TypeScript. Runtime Python dùng CLI subscription (ADR-0019) và không phục vụ lời gọi một lượt từ hub-api.

## Lựa chọn
| Phương án | Được | Mất |
|---|---|---|
| **A. SDK chính thức `@anthropic-ai/sdk`** | Kiểu đầy đủ; lỗi có lớp riêng (`AuthenticationError`…); stream + `finalMessage()` cho `max_tokens` lớn; tham số mới (`fallbacks`, `output_config`) có sẵn; tự thử lại 429/5xx | Thêm một gói (~1 MB) |
| B. `fetch` tự viết tới `/v1/messages` | Không thêm gói | Phải tự giữ hình dạng API, stream SSE, thử lại, mã lỗi. Dễ lệch khi API đổi |
| C. Qua runtime Python (job agent) | Dùng lại hạ tầng có sẵn | Chính là sự phụ thuộc engine mà lát này gỡ bỏ |

## Quyết định: phương án A
1. `@anthropic-ai/sdk` **0.135.0**, pin chính xác ở `apps/hub-api/package.json`.
2. Chỉ dùng trong `apps/hub-api/src/lib/ai-client/anthropic.provider.ts` (sau port `ModelProvider`). Gói/module khác chỉ thấy `AiClient` (`lib/ai-client/ai-client.ts`). Test thay provider giả, không gọi AI thật.
3. Mỗi lời gọi:
   - đọc tổng token trong ngày (UTC) của tenant từ `hub.usage_logs` (cột `feature` không null). Đạt trần ⇒ `CAP_EXCEEDED` và không gọi; lỗi khi đọc trần ⇒ `UNAVAILABLE`.
   - gọi model một lượt, không tool: `claude-opus-5-5` mặc định, `output_config.effort = medium`, `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), stream rồi `finalMessage()`.
   - ghi một dòng `hub.usage_logs` qua `hub.log_ai_usage` (SECURITY DEFINER, migration hub 0042). Dòng được ghi cả khi model từ chối (token đã tốn).
4. Khoá: chỉ `ANTHROPIC_API_KEY` (tuỳ chọn `ANTHROPIC_BASE_URL`). Không có khoá ⇒ client `ready = false`: mọi lời gọi trả `UNAVAILABLE`, gói không xếp job AI. Trần mặc định `AI_TENANT_DAILY_TOKENS = 5.000.000`; giá trị `0` = không trần.
5. Bảng giá nằm ở `lib/ai-client/pricing.ts` (USD/1M token, 2026-10). Model lạ ⇒ `cost_usd` null ("Chưa định giá").

## Hệ quả
- Được: một cửa duy nhất cho usage và trần theo tenant. Gói hợp đồng không còn phụ thuộc engine. Thêm tính năng AI mới chỉ cần đặt `feature` mới.
- Mất: phụ thuộc mới phải cập nhật theo nhịp phát hành SDK. Trần đọc thêm một câu SQL trước mỗi lời gọi (đường lạnh, không phải đường nóng của request).
- Nợ: trần hiện là env chung. Trần riêng theo tenant (bảng quota admin) và PDF scan qua Claude (OCR) cần ADR/lát riêng.
