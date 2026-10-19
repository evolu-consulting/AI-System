# ADR-0020 · Hạ tầng production

Trạng thái: **Proposed** · Ngày: 2026-10-17

## Bối cảnh
`compose.yaml` chỉ có Postgres và Redis; agent runtime chạy trong WSL qua `start.sh`; một server; chưa có giám sát tập trung. Không đủ cho nhiều khách.

## Quyết định
| Hạng mục | GĐ1 | GĐ2 |
|---|---|---|
| Đóng gói | Container cho mọi thành phần, kể cả runtime (bỏ WSL) | — |
| Môi trường | Staging giống production | Hạ tầng viết bằng code |
| Dự phòng | Một node | Hai node sau reverse proxy; Postgres primary + replica |
| Sao lưu | PITR Postgres; backup MinIO của FileBox; backup ra nơi khác | Diễn tập khôi phục hằng tháng có biên bản |
| Giám sát | Log, metric, trace tập trung (OpenTelemetry); cảnh báo cơ bản | Dashboard theo tenant; runbook cho từng cảnh báo |
| Cổng vào | 1 DNS wildcard, 1 reverse proxy, 1 chứng chỉ wildcard | Tên miền riêng của khách qua CNAME |

## Hệ quả
- Tiêu chí chấp nhận: diễn tập khôi phục đạt RTO; (GĐ2) tắt một node hệ thống vẫn chạy.
