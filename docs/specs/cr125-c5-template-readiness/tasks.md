---
id: cr125-c5-template-readiness
lát: cr125-c5-template-readiness
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: qc-community-flow (B1, B2)
---
## Plan (ngắn)
Công ty không bao giờ nhận mẫu Thư viện mà nó không áp dụng được. MỘT luật thuần `templateReadiness` (contracts/modules) = tính năng cần (MODULES `feature`), chức năng/tool cần, thứ tự `requires`, nhóm duyệt; hub dùng ở gán (platform), sao chép (công ty), runtime map nhóm; seed Community (D7) đưa vào mẫu dùng được.

## Làm
- contracts: `modules/template-readiness.ts` (`templateNeeds`, `templateReadiness`, `mapGroupKey` `<app>-admin`⇒`<app>-owner`) + unit.
- hub-api: `library/template-readiness.ts` (đọc phía công ty, 3 câu SQL cố định); `company-flows.service` gán chặn 422 `FLOW_TEMPLATE_NOT_READY` (nêu thiếu gì), sao chép chặn + dặn "nhờ quản trị nền tảng bật", `GET /tenants/:tid/company-flows/readiness/:flowId`; nhóm duyệt khớp nhóm có thật (B2), không khớp ⇒ bước trống "Chọn người duyệt"; `groupIdsByKey` dùng cùng luật (đường mở lượt).
- Mẫu Thư viện mới "Quản trị duyệt bài" (`flow-templates.community.ts`: Duyệt → Hiện/Ẩn bài, chỉ bước lõi) thay mẫu khe cũ (tool khoá không áp dụng được, nguyên nhân B1); seed community-demo bật Community ⇒ cùng tạo + gán mẫu (D7).
- e2e `flow-edit.cs.ts` (cherry-pick từ qc-community-flow) dùng flow "Quản trị duyệt bài".

## Không làm / Chạm
- Không đụng canvas/*, "+" menu, công tắc flow, DLC.
- Chưa làm: nút một chạm "Bật tính năng cho công ty" / "Tạo nhóm theo gợi ý" ở màn platform (hub_api không ghi schema admin; cần route admin-api) và nút "Gửi yêu cầu cho quản trị nền tảng" (chưa có cơ chế yêu cầu) — UI hiện chỉ hiển thị lỗi 422 có lý do. Mẫu khe cũ "Duyệt bài Community" còn trong Thư viện (không gán được cho công ty thiếu chức năng); gỡ ở lát sau.

## Test tối thiểu
unit `template-readiness.test.ts`, `flow-templates.community.test.ts`; int `company-flows-readiness.int.test.ts`; e2e `community-web/flow-edit.cs.ts`.

## Quyết định trong lúc làm
- Nguyên nhân B1: stage tool `community-screen/moderate/publish` của mẫu khe chưa đăng ký ở bảng tool gói ⇒ `PROCESS_REF_INVALID` khi lưu. Không đăng ký tool giả (sẽ chạy rỗng, bỏ qua sàng lọc).
- Nhóm thiếu KHÔNG chặn sao chép (giữ P15); thiếu tính năng/tool/thứ tự thì chặn.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED engine/company-flows.md
#### Yêu cầu: Mẫu Thư viện chỉ trao cho công ty khi áp dụng được
Gán (platform) và sao chép (công ty) kiểm "mẫu dùng được": thiếu tính năng/chức năng ⇒ 422 nêu thiếu gì và ai cần bật; nhóm duyệt khớp nhóm có thật của công ty, không khớp ⇒ bước chọn người duyệt.
- Kịch bản: khi mẫu cần tính năng công ty chưa bật thì gán và sao chép bị chặn kèm lý do [test: apps/hub-api/src/modules/processes/library/company-flows-readiness.int.test.ts » gán mẫu chưa dùng được]
- Kịch bản: khi mẫu chỉ cần nhóm quản trị gói thì bản sao dùng nhóm chủ gói của công ty [test: apps/hub-api/src/modules/processes/library/company-flows-readiness.int.test.ts » mẫu dùng được]

## Việc còn lại
- Nút một chạm bật tính năng / tạo nhóm cho platform (admin-api), "Gửi yêu cầu" cho công ty, UI hiển thị `readiness` trước khi gán; gỡ mẫu khe cũ "Duyệt bài Community".