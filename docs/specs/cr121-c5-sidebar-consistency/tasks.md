---
id: cr121-c5-sidebar-consistency
lát: cr121-c5-sidebar-consistency
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
CR-120 đã đưa hai app về một `Sidebar` của shell (menu sinh từ manifest). C-5 kiểm lại, gỡ phần thừa, thêm điểm neo test chung.

Khác biệt (trước → sau):
| Điểm | Community (trước) | Sổ Hợp Tác (trước) | Sau |
|---|---|---|---|
| Component | `features/shell/components/Sidebar.tsx` (manifest) | cùng | cùng, `data-testid="shell-sidebar"` |
| Độ rộng | w-56 / w-16 | cùng | cùng |
| Nhóm mục | nhóm `community` có nhãn nhóm | nhóm `contracts` | cùng cách (`ShellNavGroup`) |
| Icon | lucide (manifest) + `community/ui/icons` có 5 icon vỏ thừa | `components/icons` | một bộ; gỡ 5 icon thừa |
| Đang chọn / hover | aria-current + token act/sunk | cùng | cùng |
| Thu gọn | `nav:pinned` theo trình duyệt | cùng | cùng |
| Badge đếm | không | không | không |
| Cài đặt/hồ sơ | menu tài khoản chân thanh | cùng | cùng |
| Mobile | ẩn dưới md, BottomNav | cùng | cùng |
| Neo test | testId chỉ ở mục Community | không | `shell-sidebar` + `data-nav-item` mọi mục |

## Làm
Gỡ IconMenu/IconDashboard/IconDoc/IconUser/IconLogout trong community/ui/icons.tsx (không dùng, trùng components/icons). Thêm data-testid/data-nav-item vào Sidebar. Rail Feed là nội dung trang (vùng nội dung), không phải thanh bên.

## Không làm / Chạm
Không đổi route/quyền/API; không đụng admin-web, chat-web, DLC.

## Test tối thiểu
Unit `src/shell/nav.test.ts` (mục cùng dạng); e2e viết, chưa chạy: `e2e/community-web/sidebar-one.cm.ts`.

## Quyết định trong lúc làm
FeedRail giữ nguyên (cột phải trong nội dung).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ gỡ icon không dùng và thêm thuộc tính test; thanh trái đã là một component từ CR-120)

## Việc còn lại
Chạy e2e sidebar-one.cm.ts ở cuối đợt.