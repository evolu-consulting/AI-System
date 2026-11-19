---
id: fix-cr190-group-open
lát: fix-cr190-group-open
cr: CR-190
làn: nhanh
migration: không
phụ thuộc: cr190-msg-list-ui
---
## Plan (ngắn)
Nhóm chứa cuộc đang mở luôn mở; luật «có chưa đọc mở sẵn, còn lại thu» chỉ tính lúc tải đầu, không tự thu khi hết chưa đọc. Người dùng tự mở/thu thì nhớ như cũ.

## Làm
- [x] `lib/collapse.ts`: `freezeDefaults` (mặc định chốt lần đầu thấy nhóm), `isOpen(m, key, initial, hasSelected)`; `DirectoryView` dùng.

## Không làm / Chạm
Chạm: `packages/messages-web/src/lib/collapse.{ts,test.ts}`, `components/DirectoryView.tsx`.

## Test tối thiểu
unit `lib/collapse.test.ts`; `tsc` messages-web. e2e `j18-tin-nhan`, `cr190/danh-sach-trai` do điều phối chạy.

## Quyết định trong lúc làm
- Mặc định chốt trong `useRef` của `DirectoryView` (mất khi tải lại trang, đúng «lúc tải đầu»).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tin-nhan-giao-dien.md
#### Yêu cầu: Màn «Tin nhắn» toàn màn, menu có số chưa đọc
Nhóm chứa cuộc đang mở luôn mở. Nhóm có chưa đọc mở sẵn chỉ áp lúc tải đầu, không tự thu khi hết chưa đọc.
- Kịch bản: khi cuộc đang mở thì nhóm chứa nó luôn mở [test: packages/messages-web/src/lib/collapse.test.ts » nhóm chứa cuộc đang mở luôn mở, kể cả đã thu hay hết chưa đọc]
- Kịch bản: khi hết chưa đọc thì nhóm không tự thu [test: packages/messages-web/src/lib/collapse.test.ts » mặc định chỉ tính một lần: hết chưa đọc không tự thu, nhóm thu vẫn thu khi có chưa đọc mới]

## Việc còn lại
