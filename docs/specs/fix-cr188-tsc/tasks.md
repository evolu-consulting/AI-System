---
id: fix-cr188-tsc
lát: fix-cr188-tsc
cr: CR-188
làn: nhanh
migration:
phụ thuộc:
---
## Plan (ngắn)
Sửa lỗi `tsc` hub-api do lát cr188-sign-caption-stamp (cổng `SignHubPort.prepare` đổi hình; `font` có thể undefined; tuple test) + relock `e2e/contracts-web/cr189-avatar-list.cw.ts`.

## Làm
- [x] `sign-stamp.pdf.ts` thu hẹp kiểu `font`; `sign-stamp.pdf.test.ts` kiểu tuple; fake hub ở `sign-delegation.int.test.ts`, `sign-step-group.int.test.ts` theo hình mới (`caption` ở chữ ký, bỏ `name/title/caption` thiết lập).
- [x] `bun run test:lock:write` chỉ cho `cr189-avatar-list.cw.ts`.

## Không làm / Chạm
Không đổi hành vi. Lỗi `pmsg-db.int.test.ts:412` có từ trước, bỏ qua.

## Test tối thiểu
unit `sign-stamp.pdf.test.ts`; `tsc` hub-api; `test:lock:verify`; `openspec:check`.

## Quyết định trong lúc làm
Không có.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa kiểu)

## Việc còn lại
Không.
