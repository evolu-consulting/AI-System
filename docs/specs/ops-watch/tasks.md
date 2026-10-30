---
id: ops-watch
lát: ops-watch
cr: CR-104
làn: đầy đủ (O1) / nhanh (O2–O4)
migration: hub 0064
phụ thuộc:
---
## Plan (ngắn)
Xem `proposal.md`. Thứ tự: O1 → (O2 ∥ O3 ∥ O4). Review + security một lượt cuối; e2e một lần cuối.

## Việc
- [ ] O1 `ops-core` (Opus medium)
- [ ] O2 `ops-checks` (Sonnet)
- [ ] O3 `ops-ui` (Sonnet)
- [ ] O4 `ops-host` (Sonnet)

## Quyết định trong lúc làm
- 2026-10-30 người dùng: "làm 1 cái cho AI admin page" ⇒ kênh = trang + chuông ai-admin.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/tinh-trang-he-thong.md
#### Yêu cầu: Kiểm tra vận hành định kỳ không dùng AI
Hub kiểm các chỉ số vận hành mỗi 30 phút bằng code thường và lưu trạng thái mới nhất cùng lịch sử đổi trạng thái.
- Kịch bản: khi mọi provider AI ở `logged_out` thì check "Provider AI" thành `crit` trong lượt kiểm kế tiếp [test: thủ công — làm ở O1, thay bằng int test]
- Kịch bản: khi trạng thái một check không đổi giữa hai lượt thì không ghi thêm sự kiện [test: thủ công — làm ở O1, thay bằng int test]

#### Yêu cầu: Cảnh báo tới quản trị nền tảng
Khi một check đổi sang `warn`/`crit` hoặc hồi phục, mọi platform_admin đang hoạt động nhận một thông báo ở chuông ai-admin.
- Kịch bản: khi check chuyển `ok` → `crit` thì mỗi platform_admin nhận đúng một thông báo [test: thủ công — làm ở O1, thay bằng int test]
- Kịch bản: khi người không phải platform_admin gọi `/ops/status` thì nhận 403 [test: thủ công — làm ở O1, thay bằng int test]

#### Yêu cầu: Cấu hình kiểm tra trên UI
Platform_admin chỉnh tần suất, bật/tắt và ngưỡng từng check ở trang `/system`; có hiệu lực ở lượt kế tiếp không cần restart.
- Kịch bản: khi đổi tần suất từ 30 sang 10 phút thì lượt kiểm kế tiếp chạy theo 10 phút [test: thủ công — làm ở O1, thay bằng int test]
- Kịch bản: khi tắt một check thì check đó không chạy và không gửi cảnh báo [test: thủ công — làm ở O1, thay bằng int test]
- Kịch bản: khi ngưỡng nhập ngoài khoảng cho phép thì lưu bị từ chối 422 [test: thủ công — làm ở O1, thay bằng int test]

#### Yêu cầu: Trang Tình trạng hệ thống
Trang `/system` của ai-admin hiện từng check, gợi ý sửa, lịch sử, nút Kiểm tra ngay và Gói chẩn đoán.
- Kịch bản: khi platform_admin bấm "Kiểm tra ngay" thì thẻ cập nhật thời điểm kiểm [test: thủ công — làm ở O3, thay bằng e2e]

## Việc còn lại
Đã duyệt 2026-10-30 (câu 4: 30 phút).
