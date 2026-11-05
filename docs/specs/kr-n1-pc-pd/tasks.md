---
id: kr-n1-pc-pd
lát: kr-n1-pc-pd
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Dọn 6 ca đỏ cũ (known-red, hạn 2026-11-17) của e2e N1, P-c, P-d. Chạy evotest tìm nguyên nhân; cả 6 là test lỗi thời (không phải lỗi app) ⇒ qc cập nhật test theo hành vi hiện hành, giữ nguyên độ mạnh khẳng định.

## Làm
- N1 shell nav (desktop + mobile): nhãn mục 2 là "Hợp đồng & giao dịch" (DOC-ui-list, đổi trước CR-118); test cũ chờ "Hợp đồng".
- N1 shell giao diện: nhóm radio "Giao diện" của web-kit PrefsPanel (prefs-sync) có nút "Sáng/Tối/Theo máy", không còn "☾ Tối/☀ Sáng".
- N1 states EN: ngôn ngữ lấy từ `/auth/me` (server) trước localStorage ⇒ `installBackend` nhận `locale`, test dùng `locale: "en"`.
- P-c diff E12 EN: helper `users()` chờ ô "Tin nhắn" (tiếng Việt) sau đăng nhập; đổi locale sang en SAU đăng nhập, `g.open` tải lại trang nhận en.
- P-d Tool quy trình: tab workspace công ty đổi nhãn thành "Công cụ quy trình" (CR-112); bảng bên trong vẫn "Tool quy trình".
- Xoá 6 mục e2e:N1/P-c/P-d khỏi tests/known-red.json; test:lock:write.

## Không làm / Chạm
Không đổi code app. Không đụng đường dẫn DLC. CR-118: Community chỉ hiện khi `/pack/me` bật ⇒ không ảnh hưởng nav 4 mục trong N1 (mock không bật cờ).

## Test tối thiểu
evotest `-Step e2e -All -Filter N1|P-c|P-d`.

## Quyết định trong lúc làm
Không bỏ/nới khẳng định nào: chỉ đổi nhãn/locale/thứ tự đăng nhập.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: chỉ cập nhật test e2e lỗi thời và dọn known-red; app giữ nguyên).

## Việc còn lại