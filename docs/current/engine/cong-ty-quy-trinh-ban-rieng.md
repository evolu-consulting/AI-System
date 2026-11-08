# Engine · Quy trình bản riêng của công ty chạy được

Cập nhật: 2026-11-09 · Nguồn: cr121-c9b-company-copy-launch (CR-121). Sao chép: `cong-ty-quy-trinh.md`.

#### Yêu cầu: Quy trình bản riêng của công ty chạy được (nguồn: cr121-c9b-company-copy-launch)
Sau khi sao quy trình thư viện cho công ty, các lượt mở theo việc dùng đúng bản riêng: bước duyệt lấy từ nội dung bản riêng, số bản = bản thư viện lúc sao, snapshot của lượt ghi bản riêng. Đặt luật trỏ bản riêng ⇒ 200 và danh sách việc/quy trình của công ty báo đúng số bản. Công ty khác không bao giờ chạy bản riêng này: luật của họ trỏ vào đó ⇒ không mở được lượt, lý do "quy trình không dùng được". Code: `processes/library/company-copy-launch`.
