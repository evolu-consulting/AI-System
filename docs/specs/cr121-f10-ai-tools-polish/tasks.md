---
id: cr121-f10-ai-tools-polish
lát: cr121-f10-ai-tools-polish
cr: CR-121
làn: nhanh
migration: hub 0104 (chỉ GRANT cột)
phụ thuộc: cr121-c16-ai-tools
---
## Plan (ngắn)
UAT lượt 1: L3 agent hiện mảnh id; tenant_admin vào `/ai-tools` bằng URL. Bố cục artboard `AiTools.dc.html` không đổi.

## Làm
- L3: nguồn tên agent = `hub.agents.name` (jsonb {vi,en}; trang `/agents` lấy từ Hub `/agent-settings`). admin_rw chưa đọc được ⇒ migration hub `0104_ai_tools_agent_names.sql` `GRANT SELECT (id, key, name) ON hub.agents TO admin_rw` (chỉ 3 cột; journal idx 89, when 1805300000000 — điều phối kiểm không trùng số). `GET /admin/ai-tools` lấy tên bằng subquery theo khoá chính trong cùng UNION ALL (không thêm câu SQL: câu kiểm quyền gộp 2 quyền đọc vào MỘT câu `hubAgentAccess`; số câu trước = sau = 2 + scope). Chưa cấp cột / agent không có hàng ⇒ `name` null ⇒ nhãn "Agent chưa đặt tên" (không lộ id); ô tìm agent theo tên thật.
- tenant_admin: `PlatformOnly`/`ForbiddenState` nhận `reason`; `/ai-tools` hiện 403 "Công cụ AI do quản trị nền tảng quản lý…" và không gọi API.

## Không làm / Chạm
Không sửa e2e. Perf: không thêm câu SQL.

## Test tối thiểu
unit `ai-tools.test.ts` (tìm theo tên agent); int `workflow-tools.usage.int.test.ts` (tên agent khớp `hub.agents` khi Hub đã cấp cột, ngược lại null). Ca e2e cần qc đổi: ca nào chờ chữ "Agent …xxxxxx" ở `/ai-tools`; thêm ca tenant_admin vào `/ai-tools` thấy trang 403 có lý do.

## Quyết định trong lúc làm
- Chọn đọc tên ở server (một nguồn, theo tập) thay vì gọi Hub từ trình duyệt (cần tenant + PUBLIC_HUB_URL).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Công cụ AI hiện tên agent thật và chặn tenant_admin bằng trang có lý do
Danh sách `/ai-tools` hiện tên agent thật (chưa đặt tên ⇒ "Agent chưa đặt tên"); tenant_admin mở bằng URL thấy trang 403 nêu lý do, không gọi API.
- Kịch bản: khi tìm theo tên agent thì ra dòng agent đó [test: apps/admin-web/src/features/ai-tools/lib/ai-tools.test.ts » bộ lọc cộng dồn (AND)]
- Kịch bản: khi đọc danh sách gộp thì tên agent khớp Hub hoặc null [test: apps/admin-api/src/modules/workflow-tools/workflow-tools.usage.int.test.ts » đọc theo tập]

## Việc còn lại
- qc cập nhật e2e nêu trên.