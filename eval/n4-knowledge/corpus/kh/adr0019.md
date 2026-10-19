# ADR-0019 · AI runtime: Claude CLI / Agent SDK, đăng nhập subscription, đổi sang API key bằng cấu hình

Trạng thái: **Proposed** · Ngày: 2026-10-17 · Liên quan: ADR-0007, ADR-0008

## Bối cảnh
Agent runtime chạy Claude CLI qua `claude-agent-sdk`, provider `claude-sub`, đăng nhập bằng subscription. Người dùng chốt giữ subscription.

Tài liệu Agent SDK của Anthropic ghi: nếu chưa được duyệt, bên thứ ba không được dùng đăng nhập claude.ai hoặc hạn mức của nó cho sản phẩm của mình, kể cả agent xây trên Agent SDK; sản phẩm phục vụ khách theo Commercial Terms.

## Quyết định
1. Giữ Claude CLI / Agent SDK làm runtime; đăng nhập subscription cho nội bộ và giai đoạn đầu.
2. Cách đăng nhập là **cấu hình của worker**, không phải code. Chạy song song được: nội bộ dùng subscription, tenant production dùng API key.
3. **Cổng trước khi ký khách trả tiền:** có văn bản duyệt của Anthropic, hoặc tenant đó chạy bằng API key.
4. Mọi lần gọi ghi tenant, công thức, model, token, chi phí ước tính.
5. Lớp che dữ liệu cá nhân trước khi gửi; cờ theo tenant cấm gửi ra nước ngoài.

## Hệ quả
- Được: không đổi code; không tốn phí API ở giai đoạn đầu.
- Mất: hạn mức subscription là trần throughput; Batch API và báo cáo chi phí theo key chỉ có khi dùng API key.
- Dấu hiệu nên đổi: chạm trần, cần tính tiền AI theo tenant chính xác, chuẩn bị ký khách lớn.
