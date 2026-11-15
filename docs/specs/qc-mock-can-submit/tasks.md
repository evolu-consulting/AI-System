# qc-mock-can-submit — mock e2e contracts-web tính `can.submit` theo luật máy chủ

## Plan
`contractAsHub()` (e2e/contracts-web/dataset-contract.ts) trả `can.submit: false` cố định ⇒ nút «Gửi duyệt» ở màn xác nhận không bật sau fix-review-r3. Mock tính `submit = draft && extract ready` (người xem = người tạo/phụ trách = dataset.user), cùng contract-can.ts.

## Làm
| # | Việc | Trạng thái |
|---|---|---|
| 1 | `contractAsHub`: `can.submit` theo trạng thái | xong |
| 2 | `k2-versions.cw.ts:46` giữ `submit:false` (HĐ đã khoá, không phải nháp) | không đổi |

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: mock e2e theo luật can.submit)
