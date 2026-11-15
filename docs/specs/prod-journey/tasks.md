# prod-journey — bộ Playwright chạy tới môi trường đã deploy (3 công ty thật)

## Plan
`e2e/prod-journey/` chạy các ca FL3-1…FL3-6 của `e2e/flows3` qua URL công khai (`PJ_CW`) trên evolu / nitigroup / preschool đã onboard. Đăng nhập bằng email; lần đầu tự đổi mật khẩu tạm ngẫu nhiên (bộ nhớ). Runner: `deploy/smoke/prod-journey.ps1 -Env test|prod [-IKnowProd]`.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Config không webServer, workers 1, trace retain-on-failure | `e2e/prod-journey/playwright.prod-journey.config.ts` | [x] |
| 2 | Kit: đăng nhập + đổi mật khẩu lần đầu, thao tác HĐ chép từ flows3/smoke | `e2e/prod-journey/_kit.ts` | [x] |
| 3 | Các ca FL3-1…8 với người thật | `e2e/prod-journey/prod-journey.spec.ts` | [x] |
| 4 | Runner PowerShell | `deploy/smoke/prod-journey.ps1` | [x] |

## Quyết định trong lúc làm
- yaml thật không có nhân viên Kế toán (Hoa, Lan) và Minh (Evolu): FL3-1 do Phương (Kế toán) tạo, FL3-5a/5b/6 do Thúy Vy tạo; người duyệt là Giám đốc Tiên (leo cấp).
- Kết nối đối tác làm bằng «Tìm công ty» trong ca cần (một lần mỗi cặp mỗi lượt), vì DB prod mới chưa có đối tác.

## Việc còn lại
- Chưa chạy tới môi trường thật (điều phối chạy).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: công cụ kiểm tra môi trường đã deploy)
