---
id: fix-base-reds
lát: fix-base-reds
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa 2 lỗi đỏ có sẵn: depcruise `pack-no-platform-db-internals` (CR-145) và TS7053 ở TaskWaitingNote (kiểu task thêm "milestone").

## Làm
- `peopleReader` chuyển từ pack community sang `packs/kit/adapters/people-reader.ts`, xuất qua `kit/public`; community import qua cửa kit.
- `TaskWaitingNote`: thêm khoá `process.thread.wait.milestone` (vi+en) cho task mốc.

## Không làm / Chạm
Không nới luật depcruise, không baseline. Logic truy vấn giữ nguyên.

## Test tối thiểu
depcruise, tsc hub-api + chat-web, int `post-mention.int.test.ts`.

## Quyết định trong lúc làm
Chữ cho mốc theo cụm "xác nhận mốc" đang dùng ở inbox.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa lỗi kiểu/ranh giới)
