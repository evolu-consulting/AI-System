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
- cr181 lượt 21: 16 pass / 1 fail (K09). Chẩn đoán: người chỉ xem (e2e-ketoan) bị màn «Tạo chữ ký» chắn và GET approval trả 404 (RLS contracts_visible: kế toán không thấy HĐ của Kinh doanh). Test đã sửa (chưa chạy): tạo chữ ký lần đầu + quản trị đặt phạm vi xem = cả công ty.
- Lỗi sản phẩm phát hiện: PUT /contracts/:id/owner giao Phụ trách cho người chưa thấy HĐ ⇒ 500 (PostgresError «new row violates row-level security policy contracts_visible») thay vì 4xx.
- cr127: điều phối chạy ở checkout chính. cr141-sign-or-upload không thuộc job nào.
