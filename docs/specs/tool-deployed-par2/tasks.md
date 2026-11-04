---
id: tool-deployed-par2
lát: tool-deployed-par2
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Thêm project `ai` (03, 05, 06, 08, 12, 13: 15 test) chạy `--workers 2` song song với `ro` (4); `rw` còn 7 file / 46 test, nối tiếp sau. Đã kiểm 6 spec chỉ tạo/đọc hội thoại của chính nó (08 hỏi marker riêng; 13 đọc dify_run theo trigger=agent từ mốc bắt đầu; 12 là lệnh trigger khác). Chờ 10 phút trước rw để giữ dưới giới hạn đăng nhập IP.

## Test tối thiểu
`--list` ro 13/6, ai 15/6, rw 46/7; typecheck. Không chạy prod.

## Việc cần qc relock
`e2e/deployed/deployed.config.ts`. Không đổi spec.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đổi cách chạy bộ e2e triển khai, không đổi sản phẩm).

## Việc còn lại
Chạy thử trên prod do người dùng cho phép (chưa đo tốc độ thật).
