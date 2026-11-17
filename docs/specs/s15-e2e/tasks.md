---
id: s15-e2e
lát: s15-e2e
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s1–s14, s16
---
## Plan (ngắn)
Seed + job e2e `cr181` + hành trình 3 vai; rà 5 spec cũ cho khớp seed/route.

## Làm
- [x] `e2e/cr181/_cr181-stack.ts` (nhóm, quy trình Trưởng phòng duyệt → Ký ondoc, bật `on_doc_enabled`, chữ ký sẵn cho c22), `playwright.cr181.config.ts`, đăng ký job (`test-e2e-par.rules.ts`, `test-all.discover.test.ts`)
- [x] `e2e/cr181/journey-3-vai.spec.ts`, `_cr181-kit.ts`; sửa 5 spec cũ (tiền đề quy trình, HUB thay API, tách công ty s2/s3/c22)
- [ ] Chạy xanh job cr181 (chờ web e2e có tính năng ký + 2 fix sản phẩm)
- [ ] Chạy j01/j11/j17 + cr141-sign-or-upload (công ty tắt)

## Không làm / Chạm
Không sửa code sản phẩm.

## Test tối thiểu
`run-tests.ps1 -Step e2e -Dirty -Filter cr181`

## Quyết định trong lúc làm
- testMatch của config cr181 là chuỗi (không mảng) để evotest đếm đúng 6 spec.
- 5 spec cũ viết cho HĐ Nháp rồi gửi duyệt; quy trình thật có chặn gửi khi thiếu chỗ ký ⇒ dùng `_cr181-kit.saleSends`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: test e2e + seed e2e)

## Việc còn lại
- cr181: 7 pass / 4 fail (lượt 9). Đỏ: «Lưu chữ ký» → POST /sign body {kind,marks:[]} ⇒ 400 (web gửi marks rỗng dù đã đặt/bấm ô; `SignBody.tsx:130`); journey K05 (chuột phải sát mép trang 1 không mở menu — test đã đổi fy 0.985, chưa chạy lại).
- cr127 (j01/j11/j17): điều phối chạy ở checkout chính. cr141-sign-or-upload không thuộc job nào.
