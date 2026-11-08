---
id: cr121-f4b-commands-toggle
lát: cr121-f4b-commands-toggle
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-f4-ai-tools-workflows
---
## Plan (ngắn)
D6: gỡ `CommandsPage` làm mất công tắc bật/tắt lệnh ở hàng ⇒ thêm "Bật lệnh"/"Tắt lệnh" vào menu hàng `/ai-tools` (dòng loại lệnh). Bố cục bảng artboard `AiTools.dc.html` không đổi (chỉ thêm mục menu).

## Làm
- `features/ai-tools/hooks/use-command-row-actions.tsx`: đọc bản MỚI của lệnh (`GET /admin/commands/:id`) lấy `version`, `useUpdateCommand` (hook cũ) + `useConflictSave` (ConflictDialog `mine={enabled}` khi 409 VERSION_CONFLICT); tắt có "Hoàn tác" 5 s; xong làm mới danh sách gộp.
- Menu hàng lệnh: mục Bật/Tắt theo trạng thái hiện tại; i18n `aiTools.menu.enableCommand|disableCommand` vi+en.
- Dọn khoá i18n mồ côi (grep không còn chỗ đọc, tsc typed key xanh): `workflows.{list,guide,filter,empty}`, `workflows.menu.createCommand`, `workflows.col.{workflow,type,usedBy,status,sideEffect}`, `commands.{list,empty}` (vi+en). Giữ khoá có thể dùng động/số nhiều (`workflows.type.*`, `workflows.usage.*_one/_other`, các khoá `commands.*` còn lại).

## Không làm / Chạm
Không sửa e2e. Perf: không.

## Test tối thiểu
tsc admin-web, `i18n:check`, unit lát ai-tools. Ca e2e cần đổi (qc): `conflict-commands.spec` (ca bật/tắt + xung đột version chuyển về menu hàng `/ai-tools?kind=command`), `commands.spec` (ca công tắc ở danh sách), `cr121-list.spec` (ca `/commands` nếu còn), `m2-flow.spec`.

## Quyết định trong lúc làm
- Không dựng lại công tắc lạc quan trên hàng (bảng gộp không có cột công tắc); thao tác qua menu, trạng thái cập nhật sau khi server trả.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Công cụ AI bật/tắt lệnh ngay trên hàng
Menu hàng của một lệnh ở `/ai-tools` có "Bật lệnh"/"Tắt lệnh" (đọc phiên bản mới nhất, xung đột phiên bản hiện hộp thoại giải quyết, tắt có Hoàn tác).
- Kịch bản: khi chọn "Tắt lệnh" ở menu hàng thì lệnh tắt và có thông báo Hoàn tác [test: thủ công — thao tác giao diện qua hook cũ, e2e do qc viết lại]

## Việc còn lại
- qc viết lại ca e2e nêu trên.