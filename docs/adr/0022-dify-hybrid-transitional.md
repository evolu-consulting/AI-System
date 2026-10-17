# ADR-0022 · Hybrid tạm: Dify là công cụ AI do Hub gọi

Trạng thái: **Proposed** · Ngày: 2026-10-17 · Liên quan: ADR-0010, ADR-0017

## Bối cảnh
Chưa đủ nguồn lực để engine làm hết phần flow và phần AI ngay. Hub đã gọi được Dify (lệnh đồng bộ, `workflow.async`, tool Dify trong MCP). Dify không hợp làm xương sống của sản phẩm bán cho nhiều công ty (lượt chạy ngắn, workspace = tenant, giấy phép multi-tenant).

## Quyết định
Giai đoạn hiện tại chạy hybrid. Dify chỉ làm công cụ AI, theo bảy quy tắc:
1. Một app Dify làm một việc AI, đầu vào và đầu ra rõ, trả về đúng các trường engine cần.
2. Không có logic nghiệp vụ trong Dify: không duyệt, không rẽ nhánh nghiệp vụ, không ghi dữ liệu.
3. Chỉ Hub gọi Dify; key Dify trong kho secret của Hub.
4. Một app cho mọi khách; cài đặt khách truyền dưới dạng biến, không copy app.
5. Kết quả Dify qua cùng bước kiểm như Claude; Hub ghi token và chi phí theo khách.
6. Dify sập thì bước chờ và thử lại, hoặc chuyển sang node Claude dự phòng.
7. Log Dify chứa dữ liệu mọi khách: giới hạn người vào console, đặt hạn xoá log.

Đích dài hạn (GĐ3): engine làm hết, app Dify chuyển sang node AI, tắt Dify.

## Hệ quả
- Được: dùng lại app Dify đang chạy; không phải build node AI cho mọi việc ngay.
- Mất: hai nơi chứa công thức AI trong thời gian chuyển; phụ thuộc Dify.
- Cổng trước khi bán: Dify xác nhận bằng văn bản về điều kiện multi-tenant, hoặc mua bản thương mại, hoặc bước AI của khách đó không đi qua Dify.
