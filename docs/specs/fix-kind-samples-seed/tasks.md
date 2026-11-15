# fix-kind-samples-seed — CR-152: seed HĐ mẫu gặp 409 CONTRACT_NOT_DRAFT

id: fix-kind-samples-seed · cr: CR-152 · làn: backend (script seed)

## Làm
| # | Việc | File |
|---|---|---|
| 1 | Bỏ bước `submit` thừa: «Lưu» (review không `draft:true`) đã là gửi duyệt bằng người tạo; kiểm status trả về ≠ draft | `tools/scripts/src/seed-kind-samples.ts`, `.data.ts`, `.data.test.ts` |

Idempotent: nháp ⇒ review; đang duyệt + có run ⇒ approve_all (đích done) hoặc giữ; done/reject ⇒ bỏ qua.

## Quyết định trong lúc làm
- Chọn «review một lệnh» thay vì `draft:true` + submit: ít bước, cùng luật fix-review-r3 (người gửi = người tạo `by`).
- Chưa có int trên evotest: seed cần stack đầy đủ (auth + hub + quy trình demo); điều phối chạy `--kinds-only` trên stg-test.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa seed UAT)
