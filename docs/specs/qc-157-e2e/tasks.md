# qc-157-e2e — sửa e2e đỏ CR-157/157b, CR-158, baseline s05-failed

## Plan
Sửa test e2e đỏ lượt evotest 20261114-204757: mock route CR-157 tự ghi lời gọi (installV2f chỉ ghi route của nó), nút Gửi duyệt cần mock `/approval`, favicon mock đúng `/pack/contracts/company`, scene s05-failed đổi `a` → `button` «Nhập tay», cập nhật baseline s05-failed.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Sửa 3 ca CR-157 | `e2e/contracts-web/cr157-manual-fallback.cw.ts` | [x] |
| 2 | Sửa ca favicon | `e2e/contracts-web/cr158-tenant-favicon.cw.ts` | [x] |
| 3 | Selector + baseline s05-failed | `e2e/contracts-web/scenes.cw.ts`, `baseline/linux/s05-failed-*` | [x] |

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa test e2e và ảnh mẫu; không đổi code sản phẩm).
