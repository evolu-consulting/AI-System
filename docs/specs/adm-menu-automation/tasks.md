---
id: adm-menu-automation
lát: adm-menu-automation
cr: CR-118
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Đổi nhãn + gom nhóm sidebar "Tự động hoá" (Workflow Dify (tool AI), Quy trình nghiệp vụ); thêm dòng mô tả + link chéo đầu mỗi trang. Không đổi URL/hành vi.

## Làm
- i18n vi/en: nav.workflows/processes, nav.group.automation, nav.automation.*; tiêu đề trang (workflows.list.title, process.admin.list.title).
- nav.ts: nhóm `nav.group.automation` = [Workflows, Quy trình, Nguồn]; Agents ở lại Nền tảng.
- `components/shared/AutomationNote.tsx` dùng ở WorkflowsPage + ProcessesPage.

## Không làm / Chạm
Route, API, guard, hành vi. tenant_admin giữ nhóm "Chức năng".

## Test tối thiểu
nav.test.ts (nhóm + thứ tự), typecheck, check:bundle, evotest e2e -Filter root.

## Quyết định trong lúc làm
- Link chéo từ Workflows chỉ hiện khi engine quy trình on; từ Quy trình chỉ cho platform_admin (Workflows chỉ platform).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: chỉ đổi nhãn menu/tiêu đề, gom nhóm sidebar và thêm dòng mô tả + link điều hướng; URL, quyền, API giữ nguyên)

## Việc còn lại
- e2e khoá có thể khớp nhãn cũ: xem báo cáo, cần qc relock nếu đỏ.
