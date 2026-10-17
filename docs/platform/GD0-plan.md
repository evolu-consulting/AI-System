# GĐ0 — Nền móng (2–3 tuần)

Mục tiêu: chốt quyết định nền và chứng minh engine chạy bền **trước** khi viết code GĐ1. Không có code tính năng ở GĐ0.

## Việc

| # | Việc | Kết quả | Trạng thái |
|---|---|---|---|
| 0.1 | Thu hồi OpenAI key bị lộ trong `auto-pilot/services/dwc/app/core/config.py` | Key cũ vô hiệu (người dùng làm trên dashboard OpenAI) | Chờ người dùng |
| 0.2 | ADR-0016 Postgres là nguồn chuẩn | Proposed → duyệt ở Gate GĐ0 | Bản nháp xong |
| 0.3 | ADR-0017 Engine chạy bền (spike) | Kết luận từ spike | Bản nháp xong; spike chưa chạy |
| 0.4 | ADR-0018 Một nguồn định danh + SSO | Proposed | Bản nháp xong |
| 0.5 | ADR-0019 AI provider: CLI subscription, đổi API key bằng cấu hình | Proposed | Bản nháp xong |
| 0.6 | ADR-0020 Hạ tầng production | Proposed | Bản nháp xong |
| 0.7 | ADR-0021 Dịch vụ tri thức | Proposed | Bản nháp xong |
| 0.8 | ADR-0022 Hybrid Dify tạm | Proposed | Bản nháp xong |
| 0.9 | Bổ sung ADR-0015 FileBox: kho file chung cho mọi gói, org theo tenant, secret, sweeper, sao lưu; ghi repo và người sở hữu FileBox | Mục "Bổ sung (Platform)" | Chưa làm |
| 0.10 | Spike engine: 6 bài thử lỗi ([`spike-engine.md`](spike-engine.md)) | Báo cáo pass/fail + đề xuất | Plan xong; chưa chạy |
| 0.11 | Đo hai RAG (mgmt-app, KnowledgeHub) bằng bộ câu hỏi tiếng Việt có đáp án | Bảng điểm | Chưa làm |
| 0.12 | Liệt kê app Dify đang dùng; gửi Dify câu hỏi giấy phép multi-tenant | Danh sách + email (người dùng gửi) | Chưa làm |
| 0.13 | Staging local chạy đủ stack + giám sát nền | `docker compose` + log/metric tập trung | Chưa làm |
| 0.14 | Dọn nợ mgmt-app: xoá `cm-web`, sửa test fail, cập nhật README | Ở repo mgmt-app | Chưa làm |
| 0.15 | Chốt NFR với kinh doanh | Bảng NFR được ký | Chờ người dùng |

## Tiêu chí xong

- ADR 0016–0022 được duyệt (Accepted) ở Gate GĐ0; ADR-0015 có mục bổ sung.
- Spike có kết luận cho ADR-0017.
- Có điểm eval của hai RAG; đã gửi câu hỏi giấy phép cho Dify.
- Staging chạy; CI xanh trên repo này và mgmt-app.

## Không làm ở GĐ0

Code tính năng GĐ1, canvas, dịch vụ tri thức, SDLC/DLC, auto-pilot.

## Sau GĐ0

GĐ1 (một khách, một flow) đi qua Luật 0 (Intake) và Luật 1 (spec + spec-readiness) như mọi mốc của AI-System.
