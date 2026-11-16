---
id: cr179-msg-text
lát: cr179-msg-text
cr: CR-179
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lát 2 của CR-179 (ý 2, 3): kit `TruncText` (cắt «…», tooltip chỉ khi tràn), áp ở Tin nhắn + danh sách HĐ; nhãn công ty xuống hàng riêng; gỡ nút «Bảng tin» khỏi Tin nhắn.

## Làm
- [x] `packages/web-kit/src/ui/kit/trunc-text.tsx` + test; README kit.
- [x] Áp: ConversationRow, ChatHeader, PeopleSearch, SearchHits, ContractCells (tên HĐ, đối tác, thẻ điện thoại), ChildRows, ExtractDialog, `TruncText` workspace (bọc kit).
- [x] Nhãn công ty: hàng 2 (badge + chức vụ) ở dòng danh sách và đầu khung chat.
- [x] Gỡ `PartnerFeedDialog`, `use-feed`, `fetchFeed`, khoá i18n `messages.feed.*`, e2e dùng nút (CR161-J4, CR169-J5; bỏ bước ở CR161-J5, CR169-J1).
- [x] e2e thêm (chưa chạy): `e2e/contracts-web/cr179-trunc-tooltip.cw.ts`.

## Không làm / Chạm
Không sửa backend (`/connect/posts/:tenant_id` giữ). Không đụng Attach*/avatar/community (lát 1, 3).

## Test tối thiểu
`bun test packages/web-kit packages/messages-web apps/workspace-web`; tsc 4 gói; biome; `check:ui-kit`.

## Quyết định trong lúc làm
- `TruncText` kit có `focusable=false` cho chỗ đã nằm trong liên kết/nút (tránh tab stop lồng).
- Sidebar `title={company}` giữ nguyên (thuộc shell, lát 3; là nhãn liên kết, không phải chữ cắt).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-16 (đợt cr177-180)

### MODIFIED pack-contracts/tin-nhan.md
#### Yêu cầu: Nhãn công ty và bỏ nút Bảng tin ở Tin nhắn
Cuộc `partner`: dòng 1 là tên người; dòng 2 là nhãn công ty + chức vụ (nếu có), ở cả dòng danh sách và đầu khung chat; mỗi phần tự cắt «…» và có tooltip đủ chữ. Đầu khung chat không còn nút «Bảng tin <Công ty>» (thay CR-169 P11 phía UI Tin nhắn; API xem bài công khai ở hub-api giữ nguyên).
- Kịch bản: cuộc đối tác ⇒ nhãn công ty ở hàng riêng, không có nút Bảng tin [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR169-J1]
- Kịch bản: chữ ngắn ⇒ không tooltip, không thêm tab stop [test: apps/workspace-web/src/components/shared/TruncText.test.tsx » kit render tĩnh]

### ADDED web/chu-cat-tooltip.md
#### Yêu cầu: Chữ cắt có tooltip đủ chữ
Chữ có thể dài hơn khung dùng `TruncText` của kit: cắt «…» (1 hoặc 2 dòng); chỉ khi thật sự tràn mới hiện tooltip đủ chữ khi rê chuột/focus và cho focus bàn phím; không tràn thì không tooltip, không thêm tab stop.
- Kịch bản: đo tràn một dòng theo bề ngang, nhiều dòng theo bề cao [test: packages/web-kit/src/ui/kit/trunc-text.test.tsx » isOverflowing]
- Kịch bản: tên HĐ dài ở danh sách HĐ ⇒ rê chuột hiện tooltip đủ chữ [test: e2e/contracts-web/cr179-trunc-tooltip.cw.ts » CR179 · danh sách HĐ: tên HĐ dài bị cắt, rê chuột hiện tooltip đủ chữ]

## Việc còn lại
Chạy e2e cuối đợt (điều phối).
