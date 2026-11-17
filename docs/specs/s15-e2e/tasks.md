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
- [x] seed + job `cr181` + hành trình 3 vai + 5 spec: 17/17 xanh trên evotest (lượt 22)
- [x] test khoá cr127/cr141: điều phối chạy ở checkout chính (cr141 không thuộc job nào)

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
Không còn. Nợ ngoài phạm vi: TECH-DEBT #285 (PUT owner 500).
