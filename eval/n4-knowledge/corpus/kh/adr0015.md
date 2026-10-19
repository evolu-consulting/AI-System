# ADR-0015 · FileBox — lưu file ngoài (driver Storage `filebox`)

Trạng thái: **Accepted (Đã chấp nhận 2026-10-15, Gate FB1)** — HS2: egress thu hẹp còn chỉ `149.202.83.5:9443` (bỏ `:9000`; thay D6 gốc); HS1 (secret/crt thật, firewall, smoke) là hành động hạ tầng của người dùng · Ngày: 2026-10-15 (sửa cùng ngày: hướng tối giản v1) · CR-076, CR-077, CR-078, CR-079 · Kế thừa: HUB-FR-44, HUB-BR-29/30, ADR-0012, CR-039 · Liên quan: H2c, X2b-2, H4b-1

## Bối cảnh
Đính kèm (H2c `done`) và file trong phòng/nhóm (X2b-2 `done`) chạy sau interface Storage với driver `local`; S3/MinIO được chốt là "driver làm sau" (CR-039). FileBox là dịch vụ file nội bộ nền MinIO, chính là driver đó: API HTTPS `149.202.83.5:9443` (Bearer, cert tự ký `filebox.crt`), upload trả `file_id` (version qua `version_id`), mỗi file gắn chuỗi `org`; tải qua `/content` (proxy) hoặc `/link` (link `/d/…` 10 phút, không key); `DELETE /files/{id}` xoá mọi version, không undo. Tài liệu gốc nằm ngoài repo (`D:\AI\Filebox-INTEGRATION\`); `filebox.env`/`filebox.crt` là secret thật.

**Phạm vi v1 (người dùng chốt: "gắn nhanh nhất, xài chung, không care phân quyền"):** một key platform + một `org` chung + lưu `file_id` ở bảng attachment + tải qua `/link` redirect từ route cũ. **Ngoài v1:** phơi versioning cho user, luồng parallel-parts > 100 MB (app chặn 20 MB), `org` theo tenant.

## Quyết định
| # | Nội dung |
|---|---|
| D1 | Một driver `filebox` cho cả đính kèm hội thoại (H2c) và phòng/nhóm (X2b-2); chọn bằng `HUB_ATTACH_DRIVER=filebox`. |
| D2 | Tải browser: route attachment hiện tại (`GET /attachments/:id/...`) **đã nằm sau RLS**, nên phát `/link` từ chính route đó là đã được authz sẵn — không có việc phân quyền mới. v1 chỉ đổi bước stream bytes thành gọi `/link` (10', không key) rồi redirect; không thêm permission code. Không log URL `/d/…` đầy đủ; không phơi `file_id` ra ngoài route. |
| D3 | Một key platform duy nhất, lưu `hub.secrets` loại mới `filebox_token` (scope platform, `platform_admin`). Khớp FileBox API v1. |
| D4 | Mốc riêng, làm SAU khi P-c2 đóng. |
| D5 | **v1 dùng MỘT `org` dùng chung (hằng số, vd `ai-system`).** Ai xem file nào hoàn toàn do **RLS bảng attachment sẵn có** trên route `GET /attachments/:id/...`; không viết thêm lớp phân quyền. FileBox KHÔNG là hàng rào tenant thứ hai ở v1 — đánh đổi có chủ đích để làm nhanh. Nâng cấp sau = đổi `org` sang `t_<tenant_id>`, không phá contract (xem Hardening). |
| D6 | **Egress (hard stop):** allowlist tường minh `149.202.83.5:9443` + `:9000`; pin `filebox.crt` qua `NODE_EXTRA_CA_CERTS`; cấm `rejectUnauthorized:false`; fallback upload qua API khi `:9000` không tới. |
| D7 | `filebox.env`/`filebox.crt` không commit/log/vào FE bundle; key chỉ-ghi trong `hub.secrets` (AES-256-GCM, như H4b-1); credentials không vào job (HUB-BR-30). |
| D8 | App dùng version mới nhất; sweeper gọi `DELETE /files/{id}` khi file hết hạn/gỡ chip; mọi DELETE ghi audit (không undo). Không phơi version cho user. |

## Hệ quả
- Được: hết giới hạn đĩa local, dùng hạ tầng file có sẵn; khép lại "driver S3 làm sau"; thay đổi nhỏ (đổi driver + redirect), không thêm lớp quyền.
- Mất / rủi ro:
  - **Shared org (chấp nhận có chủ đích):** mọi tenant cùng một `org` và một key trong FileBox; cách ly chỉ nhờ RLS ở Hub. Lỗi RLS route attachment hoặc lộ `file_id`/link = đọc chéo công ty. Giảm: không đụng RLS route cũ, link TTL 10', không log URL.
  - **Mất dữ liệu:** DELETE xoá mọi version, không undo ⇒ chỉ sweeper/đường gỡ đã audit được gọi; test sweeper không xoá nhầm.
  - **Phụ thuộc dịch vụ ngoài:** FileBox sập ⇒ upload/tải lỗi (degrade rõ ràng, không chặn chat); cert tự ký cần quản lý hạn; egress thêm host:port.
  - Link `/d/…` 10' không cần key: ai có link trong 10' đều tải được.
- Mở thêm loại secret `filebox_token` (nới enum H4b-1).

## Phương án đã cân nhắc
| Phương án | Nhận xét |
|---|---|
| Giữ driver `local` | Không phụ thuộc ngoài, nhưng giới hạn đĩa một máy. |
| Hub proxy `/content` | Không phát link, tốn băng thông Hub; người dùng chọn `/link`. |

## Ghi chú v1 CORE-ONLY (2026-10-15, người dùng thu hẹp FB1)
v1 chỉ làm lõi: upload lưu `filebox_file_id/version_id`, tải `/content` inline + `/link` 302, driver mount thẳng. Các mục sau **chuyển sang "Hardening tương lai"**: (1) key qua env `FILEBOX_TOKEN` thay secret-store `hub.secrets` loại `filebox_token` (D3, CR-078) + UI Studio Secrets; (2) không dispatcher dữ liệu local cũ; (3) không sweeper `DELETE` (D8, CR-079: file tích lại FileBox, dọn sau); (4) không sửa definer `attach_claim_deleted_rooms`. Trạng thái giữ Accepted.

## Hardening tương lai (không thuộc v1)
- `org` tất định theo tenant `t_<tenant_id>` + kiểm `org` khớp tenant người gọi ở list/get/delete/link, để FileBox thành hàng rào thứ hai; đổi `org` không phá contract.
- Key theo tenant khi FileBox hỗ trợ.
- Phơi versioning (`version_id`), luồng parallel-parts > 100 MB.

## Truy vết
HUB-FR-44 · HUB-BR-29/30 · ADR-0012 (khuôn dịch vụ ngoài) · H2c · X2b-2 · H4b-1 · CR-039.
