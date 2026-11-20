---
id: cr194-preview-fix
lát: cr194-preview-fix
cr: CR-194
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chẩn đoán 2 ca đỏ cr149 trong job cr127 (hộp «Xem» PDF và .txt ra «Không mở được tệp này»).

## Làm
- Nguyên nhân (trace `0/1-trace.network` + console): MÔI TRƯỜNG e2e. Client `fetchOwnFileBlob` xin `/pack/contracts/contracts/:id/files/:fid/link` rồi `fetch(url)`.
  Stack e2e dùng FileBox GIẢ (`tests/acceptance/FB1/_fbfake.ts`) ở `http://127.0.0.1:<cổng ngẫu nhiên>`, Hub không có `FILEBOX_PUBLIC_PATH` ⇒ link tuyệt đối khác origin
  với web (`localhost:3550`), fake không gửi CORS ⇒ trình duyệt chặn («has been blocked by CORS policy»). Stg/prod đặt `FILEBOX_PUBLIC_PATH=/_fb` (nginx cùng origin) ⇒ KHÔNG bị.
- `e2e/cr149/txt-preview.spec.ts`: thêm `page.route` gắn header CORS cho link `/d/…` của fake.

## Không làm / Chạm
- Không đổi code sản phẩm. File khoá (`tests/.lock`) cần đổi để `file-preview.spec.ts` xanh: xem «Việc còn lại».

## Test tối thiểu
e2e `e2e/cr149/txt-preview.spec.ts` (job cr127).

## Quyết định trong lúc làm
- Shim CORS đặt ở spec chưa khoá thay vì sửa fake/stack đã khoá (luật A5).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa môi trường e2e; code sản phẩm không đổi).

## Việc còn lại
- `e2e/cr149/file-preview.spec.ts` (khoá) vẫn đỏ vì cùng lỗi CORS. Cần qc relock MỘT trong hai: (a) `tests/acceptance/FB1/_fbfake.ts` `serveLink`: thêm header
  `access-control-allow-origin: *` (một dòng, sửa cả mọi spec dùng link FileBox giả); hoặc (b) `_ja-stack.ts` đặt `FILEBOX_PUBLIC_PATH=/_fb` + proxy `/_fb` ở web preview.
  Sau khi (a) xong, có thể gỡ shim ở `txt-preview.spec.ts`.
