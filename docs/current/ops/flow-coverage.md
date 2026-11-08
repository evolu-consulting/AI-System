# Ops-watch: cấu hình duyệt hợp đồng nửa vời (CR-121 D-4)

Nguồn: lát cr121-d4-assign-engine (gộp 2026-11-09, đợt cr125-wave).

Check `flow_coverage` đỏ (crit; thông điệp nêu tên công ty và cách sửa, không nhắc feature) khi một công ty còn lượt duyệt HĐ đang chạy mà khe `contracts.approval` hết luật gán, hoặc luật trỏ tới quy trình đã xoá/chưa xuất bản, hoặc run duyệt HĐ kẹt chờ quyết định. Sửa xong thì xanh. Dùng để phát hiện cấu hình khách nửa vời (Luật D7).