# trello-config-ui — cấu hình Trello (góp ý) trong admin-web

Làn: **đầy đủ một vòng** (secrets) — Luật 0b. Test phần secret viết trước code.

## Plan ngắn
- Bảng `admin.trello_config` (migration `0027_trello_config`, journal idx 27, when 1798600000000): MỘT hàng (`id = 1`),
  key + token mã hoá AES-256-GCM bằng `sealBytes/openBytes` có sẵn (`apps/admin-api/src/lib/secret-crypto.ts`, khoá
  `SECRET_MASTER_KEY`), AAD riêng `admin.trello_config:<field>:<key_version>`; lưu `last4` (như `admin.secrets`), `list_id` rõ.
  RLS: chỉ `app.scope = 'platform'`; REVOKE hub_ro/PUBLIC.
- API `/admin/integrations/trello` (chỉ platform_admin):
  `GET` → `{source: db|env|none, env_configured, api_key:{set,last4}, token:{set,last4}, list_id, updated_at}` — không bao giờ trả giá trị;
  `PUT {api_key?, token?, list_id}` — trống/thiếu = giữ nguyên (lần đầu bắt buộc cả hai);
  `DELETE` → 204, về env; `POST /check` → GET Trello `/lists/:id` (header OAuth, không tạo thẻ) → `{ok, source, list_name, error}`.
- Thứ tự dùng: hàng DB (giải mã được) ⇒ dùng; không có ⇒ env `TRELLO_*` như cũ. `feedback.service` đọc cấu hình SAU commit, không chặn response.
- Audit: `entity = config`, `entity_name = integration.trello`, summary `{integration, api_key_changed, token_changed, list_id_changed}` / `{integration, cleared}` (không giá trị).
- admin-web: khối "Tích hợp › Trello" trên trang Góp ý, chỉ platform_admin.

## Quyết định trong lúc làm
- Dùng `sealBytes/openBytes` (cơ chế đã có của 2FA) với AAD tiền tố riêng, không dùng `encryptSecret` (AAD `admin.secrets:` thuộc contract Hub).
- Khối UI đặt trên trang Góp ý thay vì trang/route mới: không đổi nav/routeTree; cấu hình thuộc về tính năng góp ý.
- Audit dùng entity sẵn có `config` (không đổi CHECK `audit_log_entity_check`/contract audit).
- Đọc cấu hình khi gửi góp ý chạy trong `withScope(platform)` nội bộ server (người gửi là user tenant, RLS bảng chỉ platform).
- Giải mã lỗi (đổi khoá) ⇒ log cảnh báo không kèm dữ liệu, dùng env.
- "Kiểm tra kết nối" dùng cấu hình đang hiệu lực (đã lưu hoặc env), không nhận giá trị chưa lưu.

## Việc
| # | Việc | Làn | Trạng thái |
|---|------|-----|-----------|
| 1 | Test unit (thứ tự DB/env, che secret, AAD) + int (ghi/đọc không lộ, 403, feedback dùng DB, không DB ⇒ env) — viết trước | đầy đủ | [x] |
| 2 | Migration 0027 + RLS + catalog-rls test | đầy đủ | [x] |
| 3 | Contract + repo/service/routes admin-api | đầy đủ | [x] |
| 4 | admin-web khối Trello + i18n + e2e mock (không chạy) | nhanh | [x] |

## Lát sửa `trello-config-fix`
- e2e đỏ "Đã lưu, kết thúc bằng …1234": lỗi UI — chuỗi i18n dùng `{{x}}` trong khi admin-web cấu hình `{x}` (`app/i18n.ts`) ⇒ hiện "…{1234}". Sửa `savedEnding`/`checkOk` (vi/en).
- Thiếu SECRET_MASTER_KEY ⇒ `AppError` 503 `SECRET_KEY_UNAVAILABLE` (mã cục bộ như `HUB_NOT_CONFIGURED`, không thêm vào API_ERRORS).
- `api_key`/`token`: chuỗi trống (giữ nguyên) hoặc `^[A-Za-z0-9]+$` — chặn chèn tham số header OAuth.

## Còn lại
- e2e `e2e/trello-config.spec.ts` chưa chạy (chạy cuối đợt).
- Review + security cuối đợt.
