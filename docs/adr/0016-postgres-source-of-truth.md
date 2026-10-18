# ADR-0016 · Postgres là nguồn chuẩn cho dữ liệu giao dịch của gói

Trạng thái: **Accepted** (2026-10-18, người dùng chốt, CR-094) · Ngày: 2026-10-17 · Liên quan: docs/platform, ADR-0015, ADR-0021

## Bối cảnh
mgmt-app (Sổ Hợp Tác) lưu hợp đồng, nghĩa vụ thanh toán, người dùng, tổ chức và audit trong **OpenSearch** (`api/app/store/opensearch.py`), thêm Neo4j cho graph. OpenSearch không có transaction và nhất quán chậm; nghĩa vụ thanh toán và audit cần nhất quán ngay. AI-System dùng Postgres có RLS theo tenant.

## Lựa chọn
| Phương án | Nhận xét |
|---|---|
| Giữ OpenSearch làm kho chính | Không tốn công chuyển; giữ rủi ro mất nhất quán, không có RLS |
| **Postgres làm nguồn chuẩn, OpenSearch làm chỉ mục** | Có transaction, RLS, audit chung với lõi; tốn công chuyển dữ liệu |
| Postgres cho tất cả, bỏ OpenSearch | Gọn nhất; mất tìm kiếm hybrid BM25 + vector đang dùng |

## Quyết định
1. Mọi dữ liệu giao dịch của gói (hợp đồng, nghĩa vụ, đối tác, tổ chức, audit) nằm trong Postgres, có `tenant_id` và RLS.
2. OpenSearch chỉ là chỉ mục tìm kiếm, nạp từ outbox, xoá đi dựng lại được hoàn toàn từ Postgres.
3. Neo4j mặc định bỏ, trừ khi eval của dịch vụ tri thức (ADR-0021) chứng minh có lợi.
4. Chuyển dữ liệu 6 bước: dựng bảng → ghi kép → nạp dữ liệu cũ → đối soát 100% trong 7 ngày → chuyển đọc → tắt ghi cũ. Mỗi bước quay lại được.

## Hệ quả
- Được: nhất quán ngay, RLS, audit chung, transaction kèm outbox.
- Mất: công chuyển dữ liệu trên hệ thống đang có khách thật; thời gian ghi kép.
- Tiêu chí chấp nhận: không còn ghi giao dịch vào OpenSearch; dựng lại chỉ mục từ Postgres không lệch.
