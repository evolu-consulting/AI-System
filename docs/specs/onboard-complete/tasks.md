---
id: onboard-complete
title: Công ty tạo bằng onboarding "chỉ việc dùng" (danh bạ bật sẵn + AI cài sẵn)
cr: CR-159
---
# onboard-complete

| # | Việc | Trạng thái |
|---|---|---|
| 1 | Onboarding bật danh bạ qua `setDirectoryListed` (khoá yaml `directory`, mặc định bật khi đủ `legal_name` + `tax_id`) | xong |
| 2 | `deploy/tenants/onboard-all.sh`: onboarding → `tenant-ai-setup --apply` → `tenant:flows` (khác vai DB nên tách bước) | xong |

## Quyết định trong lúc làm
- Dịch vụ danh bạ chỉ nhận `tenant_admin` của chính công ty ⇒ CLI gọi với vai đó (file yaml = đồng ý của công ty), người ghi audit là `--actor`.
- `tenant-ai-setup` chỉ SQL (không gọi nhà cung cấp AI) ⇒ không cần đăng nhập Claude.
- Test cũ `onboard.rules.test.ts` (nitigroup addons) đỏ sẵn từ trước vì yaml có `contracts-partner-confirm`; không thuộc lát này.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/onboarding-cong-ty.md

#### Yêu cầu: Công ty tạo bằng onboarding có danh bạ bật sẵn và AI cài sẵn
- Kịch bản: Hồ sơ có tên pháp lý và MST ⇒ danh bạ công ty được bật, chạy lại không đổi gì [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.directory.int.test.ts » đủ tên pháp lý + MST ⇒ bật danh bạ, chạy lại không đổi (version, audit)]
- Kịch bản: Thiếu MST hoặc khai không bật ⇒ danh bạ không bật [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.directory.int.test.ts » thiếu MST hoặc khai `directory: unlisted` ⇒ không bật, không lỗi]
- Kịch bản: Công ty mới được cài trợ lý AI và gói tri thức, chạy lại không đổi [test: tools/scripts/src/tenant-ai-setup.int.test.ts » chạy thử không ghi, --apply cài đủ, chạy lại không đổi]
