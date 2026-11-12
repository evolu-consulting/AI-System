---
id: fix-msg-fn
lát: fix-msg-fn (review cuối CR-132 · Minor #5 `check:fn`)
cr: CR-132
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Tách các factory dài của vùng `packs/contracts/messages/**` thành nhóm hàm nhỏ (≤ 50 dòng) theo `check:fn`, giữ nguyên hành vi và cửa công khai (`messagesUsecases`, `messagesRoutes`, `messagesRepo`, `messagesSendRepo`, `messagesFileOps`, `messagesModule`).

## Làm
- `messages.usecase.ts`: `context(d)` (emit/peopleOf/detail/active dùng chung) + `creationOps` · `conversationOps` · `memberOps` · `readOps` · `sendOps`; `messagesUsecases` ghép lại.
- `messages-files.usecase.ts`: `uploadFile` · `fileLink` · `dropBytes` tách khỏi `messagesFileOps`.
- `messages.routes.ts`: `helpers(view)` + `conversationRoutes` · `memberRoutes` · `messageRoutes` · `fileRoutes`.
- `messages.repo.ts`: `readRepo` + `memberRepo`; `messages-send.repo.ts`: `pageRepo` · `sendRepo` · `revokeRepo` · `fileRepo`.
- `packs.mount.ts`: dòng mount `messagesModule` gọn một dòng (+ bỏ một dòng trống) để file ≤ 400 dòng (đang 404 ở nhánh gốc); `messagesModule` nhận `filebox` có thể `null`.
- Còn đỏ `check:fn` ở FILE TEST (`messages.int/rls/stream`, `messages.view.test`, web `messages-lib.test`) — ngoài phạm vi yêu cầu.

## Test
unit `messages` (domain + application) local + int `messages`, `messages-files`, `messages-rls`, `messages-stream` trên evotest; tsc hub-api; `check:fn`/`check:size` hết cảnh báo ở file nguồn của vùng.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-12 (đợt cr132-wave)
Không thay đổi hành vi (lý do: tách hàm theo check:fn)
