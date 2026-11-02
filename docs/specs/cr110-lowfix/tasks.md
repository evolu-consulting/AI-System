---
id: cr110-lowfix
lát: cr110-lowfix
cr: CR-110
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa 3 phát hiện mức Thấp cuối đợt CR-110.

## Làm
1. community-web: tiêu đề HTML tĩnh trung tính "Community" (không lộ tên Sổ Hợp Tác cho đối tác trước khi /viewer tải).
2. admin-web: hộp xác nhận thu hồi ở tab Feature liệt kê tên thân thiện của mọi feature bị thu hồi (`lib/revoke-message.ts`).
3. hub-api: `GET /pack/community/brand` có ETag mạnh (sha-256 thân JSON) + `Cache-Control: private, max-age=300`, `If-None-Match` khớp ⇒ 304. Client không thêm cache-busting (web-kit `api` không đặt `no-store`).

## Không làm / Chạm
Không đổi contract brand (vẫn 4 trường). Không e2e.

## Test tối thiểu
unit `revoke-message.test.ts`; int `community-ports.int.test.ts` (ETag/304).

## Quyết định trong lúc làm
- `confirmBody` thêm tham số `{list}`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Brand chủ quản được cache bởi trình duyệt
`GET /pack/community/brand` trả ETag mạnh và `Cache-Control: private, max-age=300`; yêu cầu có `If-None-Match` khớp nhận 304 không thân; nội dung vẫn đúng 4 trường.
- Kịch bản: khi đối tác gọi lại `/brand` với `If-None-Match` đúng ETag thì nhận 304 [test: apps/hub-api/src/modules/packs/community-ports.int.test.ts » ETag mạnh + Cache-Control private, If-None-Match khớp ⇒ 304, đối tác vẫn đúng 4 trường]

### MODIFIED community/hien-thi.md
#### Yêu cầu: Tiêu đề trang tĩnh trung tính
Tiêu đề HTML tĩnh của community-web là "Community", không chứa tên Sổ Hợp Tác; tiêu đề runtime chuyển sang tên công ty.
- Kịch bản: khi mở community-web trước khi /viewer tải thì tiêu đề là "Community" [test: thủ công — cấu hình rsbuild tĩnh]

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Xác nhận thu hồi feature liệt kê tên
Hộp xác nhận lưu tab Feature liệt kê tên thân thiện của mọi feature sẽ bị thu hồi, gồm tính năng thêm bị gỡ khi đặt app về Tắt.
- Kịch bản: khi đặt app Hợp đồng về Tắt thì lời nhắc liệt kê cả tính năng thêm [test: apps/admin-web/src/features/tenants/lib/revoke-message.test.ts » liệt kê tên của mọi feature thu hồi, gồm tính năng thêm khi đặt app về Tắt]

## Việc còn lại
Không.
