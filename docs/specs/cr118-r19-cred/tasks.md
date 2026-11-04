---
id: cr118-r19-cred
lát: cr118-r19-cred
cr: CR-118
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Hồi quy React 19 ở e2e P-c2 E02: tạo khoá xong ô "Khoá nguồn" quay về "Không — repo công khai".
Nguyên nhân: Radix Select (trong form) có `<select>` ẩn; khi value đổi nó gán select.value rồi bắn "change". Item của khoá vừa tạo
mount cùng lượt render với value mới, effect của select ẩn chạy trước khi `<option>` đăng ký (React 19) ⇒ select.value = "" ⇒ Radix gọi
`onValueChange("")` ⇒ `onChange("")` ghi đè lựa chọn. Sửa: bỏ qua "" (NONE là sentinel của ô này nên "" không phải lựa chọn thật).

## Làm
- `features/sources/lib/credential-choice.ts` (+ test) · `CredentialField.tsx` dùng `credentialChoice`.
- Quét mẫu onCreated→onChange trong admin-web/chat-web: chỉ CredentialField; Select khác dùng option tĩnh.

## Không làm / Chạm
Không sửa e2e khoá.

## Test tối thiểu
unit `credential-choice.test.ts`; e2e `P-c2` (evotest, một lần).

## Quyết định trong lúc làm
Không có thư viện DOM trong repo ⇒ test unit trên hàm thuần; hành vi thật kiểm bằng e2e E02.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: khôi phục hành vi đã mô tả ở HUB-FR-68 "tạo khoá xong tự chọn khoá" sau khi nâng React 19)

## Việc còn lại
