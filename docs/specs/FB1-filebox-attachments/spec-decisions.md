# Quyết định đã chốt · FB1-filebox-attachments

Nguồn: [ADR-0015](../../adr/0015-filebox-external-file-storage.md) (Proposed) · CR-076…079. Intake Đầy đủ 2026-10-15. Hướng v1: "gắn nhanh nhất, xài chung, không care phân quyền".

| # | Quyết định | CR |
|---|---|---|
| D1 | Một driver `filebox` cho cả H2c và X2b-2, chọn bằng `HUB_ATTACH_DRIVER=filebox`; lưu `file_id` (và `version_id` khi cần bản chính xác). | CR-076 |
| D2 | Tải: route `GET /attachments/:id/...` đã sau RLS ⇒ phát `/link` (10', không key) từ chính route rồi redirect; không thêm permission code; không log URL `/d/…`; không phơi `file_id` ngoài route. | CR-076 |
| D3 | **[v1 CORE-ONLY: Hoãn — key qua env `FILEBOX_TOKEN`]** Một key platform duy nhất, loại secret mới `filebox_token` trong `hub.secrets` (scope platform, `platform_admin`, chỉ ghi, AES-256-GCM `HUB_SECRETS_KEY`). | CR-078 |
| D4 | Mốc riêng, làm SAU khi P-c2 đóng. | CR-076 |
| D5 | MỘT `org` chung (hằng, vd `ai-system`); ai xem file nào = RLS bảng attachment sẵn có; FileBox không là hàng rào tenant thứ hai (đánh đổi có chủ đích). Nâng cấp sau = `t_<tenant_id>`, không phá contract. | CR-077 |
| D6 | Egress (hard stop): allowlist `149.202.83.5:9443` + `:9000`; pin cert qua `NODE_EXTRA_CA_CERTS`; cấm `rejectUnauthorized:false`; fallback upload qua API khi `:9000` không tới. | CR-077 |
| D7 | `filebox.env`/`filebox.crt` không commit/log/vào FE bundle; key chỉ-ghi; credentials không vào job (HUB-BR-30). | CR-078 |
| D8 | **[v1 CORE-ONLY: sweeper DELETE Hoãn]** App dùng version mới nhất; sweeper `DELETE /files/{id}` khi hết hạn/gỡ chip; mọi DELETE ghi audit (không undo); không phơi version cho user. | CR-079 |
| D9 | Phạm vi v1: một key + một org + `file_id` ở bảng attachment + `/link` redirect. Ngoài v1: phơi versioning, parallel-parts > 100 MB (app chặn 20 MB), org-per-tenant, key-per-tenant. | CR-076 |

Ghi chú: ADR-0015 liệt kê D1…D8; D9 ở đây = dòng "Phạm vi v1" của ADR/CR-076, tách riêng cho dễ tra.

Security review dự kiến: cách ly tenant NHẸ (xác nhận RLS route cũ không đổi + chấp nhận shared org); egress/secret ĐẦY ĐỦ.
