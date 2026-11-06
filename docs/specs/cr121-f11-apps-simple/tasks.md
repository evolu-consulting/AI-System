---
id: cr121-f11-apps-simple
lát: cr121-f11-apps-simple
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c
---
## Plan (ngắn)
Người dùng chê tab Công ty › Ứng dụng: "chữ Tắt bị lệch, nhiều chữ quá, design phải đơn giản". Đối chiếu `Company.dc.html`, bỏ chữ thừa.

## Làm
- `LevelControl`: 4 ô đều nhau (`grid-cols-4` + vạch chia), chữ cùng cỡ/đậm/`leading-none`, ô đang chọn chỉ đổi nền (`bg-primary/10`) và giữ màu chữ như các ô khác.
- Bớt chữ: bỏ đoạn mô tả dưới tiêu đề, tiêu đề chỉ "Ứng dụng"; cột Trạng thái chỉ "Đang bật/Đang tắt" (lý do chỉ khi KHÁC hiển nhiên: việc chưa bật quy trình, quyền không chuẩn); cột Quy trình "0/3 bật" (link); "Chi tiết" thành mũi tên cuối hàng; hàng "Khác" bỏ "Theo từng tính năng".
- Một chỗ cho số liệu: bỏ dòng "Tạo lúc · n user" và dòng tóm tắt đầu trang (`TenantSummaryLine` xoá), giữ 4 ô số. "Ứng dụng đang bật x / y" đếm MỘT cách (`appsOnCount`): Cơ bản (luôn bật) không tính, y = số ứng dụng chọn được.
- Thanh lưu tab Ứng dụng chỉ hiện khi có thay đổi, nhãn "Huỷ · Lưu".
- Thanh bên: nhớ mở/thu gọn theo lần bấm gần nhất, mọi trang như nhau (`shell/lib/sidebar-pref.ts`, localStorage có try/catch). Trong code KHÔNG có việc tự mở ở `/` hay tự thu ở trang khác (kiểm `Sidebar.tsx`/`AppShell.tsx`): nếu UAT thấy hành vi đó là do giá trị `ai.sidebarCollapsed` đã lưu từ lần bấm trước.
- i18n: bỏ khoá không còn dùng (`tenants.summary`, `summaryFlows`); `tenants.apps.title` = "Ứng dụng"/"Apps"; `flowsCount` = "{on}/{total} bật".

## Không làm / Chạm
Không sửa e2e. Dòng tóm tắt "x/y việc có quy trình" của c14 bỏ theo yêu cầu người dùng (số này còn ở cột Quy trình của bảng).

## Test tối thiểu
- unit: `tenants/apps/lib/apps-table.test.ts » CR-121 f11 · appsOnCount`, `shell/lib/sidebar-pref.test.ts`, `LevelControl.test.tsx` (sẵn có).

## Ca e2e cần đổi (qc, không chạy)
- Mọi ca đọc dòng tóm tắt đầu trang công ty (`tenant-summary`, `summary-flows`, "x/y việc có quy trình") và "Tạo lúc … · n user": `cr121-c14-tabs.spec.ts`, `cr112-nav`/`cr121-tenants*`.
- Ca đọc "· quyền truy cập đang Tắt", "· luôn bật", "Quy trình: x bật · y tắt", nút chữ "Chi tiết" (nay là nút mũi tên `aria-label` "Chi tiết"), "Theo từng tính năng", "Chưa có thay đổi"/"Hoàn tác thay đổi" (thanh lưu ẩn khi không đổi; nhãn "Huỷ"): `feature-ui.spec.ts`, `app-config.spec.ts`, `cr121-c-flows.spec.ts`.

## Ảnh trước/sau
- Trước: `…\scratchpad\uat-cr121c\02b-ung-dung-platform.png`; sau: `…\scratchpad\uat-cr121c\f11\shots\02b-ung-dung-platform.png`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/cong-ty-ung-dung-gon.md
#### Yêu cầu: Tab Ứng dụng gọn và nhất quán
Bảng ứng dụng chỉ nêu lý do khi khác hiển nhiên, số ứng dụng đang bật đếm một cách (không tính Cơ bản), thanh lưu chỉ hiện khi có thay đổi; thanh bên nhớ mở/thu gọn theo lần bấm gần nhất.
- Kịch bản: Cơ bản không tính vào "ứng dụng đang bật x / y" [test: apps/admin-web/src/features/tenants/apps/lib/apps-table.test.ts » CR-121 f11 · appsOnCount (một cách đếm)]
- Kịch bản: thanh bên nhớ lần bấm gần nhất, kho lỗi thì mở [test: apps/admin-web/src/features/shell/lib/sidebar-pref.test.ts » CR-121 f11 · sidebar-pref]

## Việc còn lại
- e2e (qc) theo danh sách trên.