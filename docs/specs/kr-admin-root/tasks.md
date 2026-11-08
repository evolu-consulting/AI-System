---
id: kr-admin-root
lát: kr-admin-root
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Xoá đỏ có sẵn `e2e:root` / `e2e:root-0` trong `tests/known-red.json` (hết hạn 2026-11-17). Mỗi ca: phân loại lỗi app hay test cũ; không có lỗi app nào — toàn bộ là test cũ hoặc hạ tầng e2e.

## Làm
- workflows.spec, conflict-workflows, workflows-dify (2 ca), m2-flow: test cũ. CR-112 (nav.ts) đổi mục menu thành link "Workflow Dify (tool AI)" và h1 cùng tên (không còn nhóm sổ xuống DLC-R15 "Workflow Process"). Sửa `openPage(...)` + helper `openWorkflowProcessFromNav`. workflows-dify còn lỗi test: `ID.workflow` là object → dùng `ID.workflow.translate`.
- cr052-login (3 ca): test cũ. prefs-sync chốt mặc định chung `vi` (unit `apps/admin-web/src/app/i18n.test.ts`); ca 1 + 3 đổi sang kỳ vọng tiếng Việt, cùng độ mạnh (heading h1, lang, title, aria-pressed, showcase ≥1024px). Ca "công tắc EN/VI" đã xanh.
- m4-usage E6/E7/E8: test cũ (tenant-admin-scope 2026-10-21: tenant_admin chỉ số run/token, không tiền, không CSV). E6: tenant_admin không có region "Số thu"/"Chi phí thật"/"Biên", body không có cost/margin/billable; E7: platform_admin thấy "Chưa định giá"/"Vượt quota", binh không thấy; E8: CSV (BOM, billable_usd) kiểm bằng platform_admin, binh không có nút.
- usage-analytics (2 ca): hạ tầng e2e. `e2e/support/prepare-db.ts` chỉ chạy `runMigrations` (stub dev) nên thiếu `usage_logs.feature/app/outcome` + `usage_daily` (hub 0049). Thêm `runHubMigrations` như các stack P-a/P-b/chat; giữ nguyên assertion.
- secrets "quét rò", m4-audit E17, m4-2fa D11: quá giờ khi máy tải cao → `test.slow()` (nới timeout x3, assertion giữ nguyên). m4-2fa D11 không nằm trong known-red nhưng đỏ mới cùng nguyên nhân.

## Không làm / Chạm
Không sửa app (admin-web/admin-api). Chỉ `e2e/**`, `tests/known-red.json`, `tests/.lock`.

## Test tối thiểu
`powershell deploy/evotest/run-tests.ps1 -Step e2e -All -Filter root`.

## Quyết định trong lúc làm
Quyết định sản phẩm không cần hỏi: các thay đổi app đã chốt trước (CR-112, prefs-sync, tenant-admin-scope) là nguồn đúng.

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: chỉ cập nhật e2e theo hành vi app đã chốt, sửa hạ tầng e2e và gỡ đỏ có sẵn khỏi known-red)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)
