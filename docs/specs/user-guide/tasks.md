# user-guide — CR-159 (Hướng dẫn sử dụng + Tài liệu nghiệp vụ có ảnh giao diện thật)

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: tài liệu)

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Hướng dẫn sử dụng theo vai và theo việc, có FAQ | Claude Docs, tab «Hướng dẫn sử dụng» (`docs/guide/README.md`) | [x] |
| 2 | Tài liệu nghiệp vụ (vai, 5 loại HĐ, quy trình, trạng thái, bằng chứng, kết nối, 3 công ty, giới hạn) | Claude Docs, tab «Tài liệu nghiệp vụ» | [x] |
| 3 | Ảnh chụp bản test (công ty tạm smoke-a/smoke-b, đã xoá sau khi chụp) | 41 ảnh lưu trên Claude Docs | [x] |

## Quyết định trong lúc làm
- Ảnh chụp bằng công ty tạm của bài kiểm hành trình, không dùng tài khoản evolu / nitigroup / preschool. Mật khẩu tạm chỉ ở bộ nhớ tiến trình, không ghi vào tài liệu.
- Chưa có ảnh: Trả lại / Từ chối có lý do, màn AI không đọc được (AI đọc được hết file mẫu). Ảnh «Nhập tay, chọn Loại» chụp ở bản nháp có 5 loại. Bảng tin chỉ chụp phần đăng bài và danh sách (Community đang có lỗi tệp đính kèm).
- Script chụp (`e2e/smoke-journey/guide-shots.smoke.ts`, `deploy/smoke/guide-shots.ps1`) không đưa vào commit.
