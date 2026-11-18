---
id: cr184-avatar
lát: cr184-avatar
cr: CR-184
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Ý (4) CR-184: «Phụ trách» và dải người ký đổi sang avatar + tooltip; dòng thông tin đầu trang căn giữa dọc.

## Làm
- [x] MetaList căn giữa dọc; `OwnerRow` = avatar + tooltip, danh sách chọn có avatar/họ tên/chức vụ; `SignersStrip` = avatar viền theo bên.
- [x] `AvatarTip`/`TouchTip` (rê, focus, chạm giữ), `usePeopleCards` (`GET /people?ids=`).

## Không làm / Chạm
Không đổi API, quyền, contract. Chạm: meta-list.tsx (kit), ManagePanel.tsx, SignersStrip.tsx, contract-view.ts, i18n work.

## Test tối thiểu
unit SignersStrip.test.tsx, OwnerRow.test.tsx.

## Quyết định trong lúc làm
- Chữ tooltip cũng đặt trong DOM (sr-only) để đọc màn hình và e2e cũ (`toContainText`) vẫn đúng.
- Ảnh người khác lấy từ `GET /people?ids=` (tối đa 50 người/lần); quá 50 ⇒ chữ cái đầu.
- `owner-select` nay là nút mở danh sách (không còn select): e2e gapa1-manage cần chọn qua `owner-option-<id>` (báo qc).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED contracts/chi-tiet-hop-dong.md
#### Yêu cầu: Dòng thông tin đầu trang hợp đồng căn giữa dọc, «Phụ trách» là avatar
Nhãn, huy hiệu và ô «Phụ trách» cùng một đường giữa. Ô «Phụ trách» chỉ hiện avatar người phụ trách (thiếu ảnh ⇒ chữ cái đầu); rê chuột, focus bàn phím hoặc chạm giữ hiện «Phụ trách: <họ tên>». Mở ô chọn: mỗi dòng avatar + họ tên (+ chức vụ). Quyền đổi người và API giữ nguyên.
- Kịch bản: khi xem HĐ không có quyền ghi thì chỉ thấy avatar kèm tooltip «Phụ trách: <họ tên>» và không có nút chọn [test: apps/workspace-web/src/features/contract-review/components/OwnerRow.test.tsx » chỉ đọc: avatar + tooltip, không có nút chọn]
- Kịch bản: khi có quyền ghi thì nút mở danh sách có nhãn «Phụ trách: <họ tên>» và vùng bấm 44px trên điện thoại [test: apps/workspace-web/src/features/contract-review/components/OwnerRow.test.tsx » có quyền ghi: nút mở danh sách mang nhãn «Phụ trách: tên», vùng bấm 44px trên điện thoại]


#### Yêu cầu: Dải người ký là avatar có viền theo bên
Mỗi người ký một avatar viền tím (Bên A) / cam (Bên B); tooltip «<họ tên> · Bên A · n chỗ ký» hoặc «Đã ký»; đã ký có dấu ✓ nhỏ trên avatar. Người ký nhóm: một avatar mỗi thành viên, tooltip liệt kê tên.
- Kịch bản: khi người ký đã ký thì avatar có dấu ✓ và tooltip ghi «Đã ký» [test: apps/workspace-web/src/features/doc-sign/components/contract/SignersStrip.test.tsx » đã ký có dấu ✓, chưa ký không có]
- Kịch bản: khi người ký là nhóm thì hiện một avatar mỗi thành viên [test: apps/workspace-web/src/features/doc-sign/components/contract/SignersStrip.test.tsx » nhóm: một avatar mỗi thành viên, tooltip liệt kê tên]

## Việc còn lại
qc: e2e/contracts-web/gapa1-manage.cw.ts:67 (`pickOption(owner-select…)`) cần mở `owner-select` rồi bấm `owner-option-<id>`.
