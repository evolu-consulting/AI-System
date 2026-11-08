# Admin · catalog, quota, agent, secret, audit, transfer

Cập nhật: 2026-11-03 · Nguồn: PDF Phần A.

## Command và Workflow (catalog, ĐÓNG BĂNG)
Workflow Dify dùng chung; command `/` trỏ tới đúng một workflow. Bảng: `workflows` (key, name, description 20–400 ký tự, app_type, base_url, secret_id, input_schema jsonb, output_field, dify_app_id, enabled, side_effect, version), `commands` (name, aliases[], description, workflow_id, args, input_map, output, mode sync/async, timeout_s, enabled, version), `command_names` (tên + alias duy nhất toàn hệ thống), `tenant_workflow_tools` (công tắc tool theo tenant, Hub chỉ đọc).
- FR-10/11 CRUD workflow + nhập input schema tay (mô tả bắt buộc, Hub dùng làm tool cho model) · FR-13 không xoá/tắt workflow đang dùng (hộp xác nhận liệt kê nơi dùng) · FR-14/15 workflow "Chưa gắn" hợp lệ + cột "Đang được dùng bởi" · FR-20..22 CRUD command; input map các nguồn `$args.*`, `$selection`, `$page.url/text`, `$attachment`, `$user.id`, `$tenant.id`, hằng · FR-23 nút Test chạy bản nháp qua Hub · FR-73 công tắc tool quy trình theo tenant (audit mỗi lần).
- BR-01 tên/alias duy nhất (chữ thường/số/-) · BR-02 mỗi command → 1 workflow · BR-06 thực thể tắt vẫn lưu, Hub coi như không tồn tại · BR-04 secret không ra khỏi Admin.
- CRUD do platform_admin; catalog toàn cục (không RLS), riêng `tenant_workflow_tools` có RLS.

## Quota và chi phí
Vượt quota KHÔNG chặn, chỉ cảnh báo + tính phần vượt. Bảng `tenant_quotas` (tenant_id, feature_id null = cả tenant, period month, max_runs, max_tokens, max_usd, warn_pct mặc định 80), `quota_alerts`, `tenant_daily_limits` (uploads/actions/ai_tokens; null = dùng env). Đọc `hub.usage_logs`.
- FR-40 platform_admin đặt quota tháng; mặc định không giới hạn · FR-41 cảnh báo 80% và 100% cho tenant_admin (email + banner), phần vượt Hub đánh dấu `overage` · FR-42 màn "Chi phí & quota" (KPI, thanh quota, biểu đồ ngày, top feature, CSV): platform_admin thấy `cost_usd` + `billable_usd`, tenant_admin chỉ số của tenant mình · hạn mức ngày `GET/PUT /admin/tenants/:id/daily-limits` + reset, chỉ platform_admin (uploads/actions theo múi giờ tenant, ai_tokens theo UTC) · tenant-admin-scope: usage rút gọn (lượt/token/% quota, không tiền; analytics/records/csv ⇒ 403) · NFR-03 báo cáo 1 tháng < 2 giây.

## Agent Hub — cấp agent
Dữ liệu thuộc schema `hub` (`hub.agent_grants`, `hub.agent_workflows`; Admin đọc `hub_ro`, ghi qua API Hub). FR-37 cấp agent cho group; FR-13/15 workflow được agent dùng thì chặn xoá/tắt; BR-13 quyền agent nằm ở agent-grant. Luật entitlement agent × tenant thuộc BA Agent Hub (ngoài ai-admin).

## Secrets
`admin.secrets` (name unique, ciphertext, iv, key_version, last4, note, updated_by); Hub có `hub.secrets` riêng. FR-50 CRUD (platform_admin), AES-256-GCM, master key `SECRET_MASTER_KEY` ở env · BR-04 giá trị không bao giờ trả ra qua API/UI/export; `GET /admin/secrets` chỉ trả tên + last4 (AC-A06) · FR-51 audit chỉ ghi "đã đổi" · FR-54 export chỉ ghi tên.

## Audit / nhật ký
`admin.audit_log` (seq, at, tenant_id, actor_id, action, entity enum 12 giá trị, entity_id, before/after jsonb, summary, snapshot), append-only (trigger). FR-51 mọi thay đổi cấu hình/user/group/quyền/quota ghi audit; FR-52 khôi phục thực thể về trạng thái "trước" (`POST /admin/audit/:id/restore`); FR-55 chống ghi đè bằng `version` (409). tenant_admin chỉ thấy audit user/group/grant/entitlement của tenant mình, bỏ before/after/version/file/tenant_key.

## Quy trình, Nguồn, Export/Import
Quy trình (ADM-FR-65..71): trang + editor + run + token theo run; dữ liệu `hub`; editor admin dùng khi `HUB_PROCESS_ROUTES=admin`; FR-70 đã bỏ (CR-074). Nguồn tham chiếu (FR-68/69): `git_remote`, `library`, `local_path`, nút "Kiểm tra kết nối" (đóng băng). Export/Import yaml (FR-54): workflow, command, feature, tenant, group, grant; nhập có bước xem diff; trần 5000 mỗi loại (module `transfer` đóng băng).


## Delta gộp 2026-11-09 (đợt cr125-wave)
Mục dưới thắng nội dung cũ cùng chủ đề ở trên (lát: cr121-r4-feature-save-race).

#### Yêu cầu: Editor Feature giữ nháp khi lưu liên tiếp (nguồn: cr121-r4-feature-save-race)
Sau khi lưu, form dựng lại theo ĐÚNG phản hồi của lần lưu (không chờ tải lại danh sách). Người dùng sửa tiếp trong lúc chờ thì nháp command được giữ (và vẫn tính là chưa lưu); phản hồi/tải lại cũ hơn bản đã áp bị bỏ qua; một command không bao giờ xuất hiện hai lần trong danh sách.
- Kịch bản: khi phản hồi lưu lần 1 về muộn sau khi người dùng đã bỏ một command thì nháp được giữ và vẫn chưa lưu [test: apps/admin-web/src/features/features/lib/save-merge.test.ts » phản hồi lưu lần 1 về muộn sau khi người dùng bỏ /kiemtra-hoadon: giữ nháp [tom-tat], vẫn dirty]
- Kịch bản: khi thêm command đã có thì danh sách không có hàng trùng [test: apps/admin-web/src/features/features/lib/save-merge.test.ts » không bao giờ có id lặp (nhân đôi hàng /tom-tat)]
- Kịch bản: khi tải lại cũ về sau bản mới hơn thì giữ bản mới hơn [test: apps/admin-web/src/features/features/lib/save-merge.test.ts » refetch cũ (v2) về sau khi đã có v3 trong cache ⇒ giữ v3]
- Kịch bản: khi lưu, bỏ command chỉ thuộc feature này rồi thêm lại thì lưu được liên tiếp [test: thủ công — e2e/features.spec.ts ca CR-055 M2-AC04 chạy ở verify:wave (tiêu đề ca chứa dấu chấm phẩy nên không trích được)]
