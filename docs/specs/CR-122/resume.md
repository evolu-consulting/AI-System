# CR-122 — điểm dừng (2026-11-07, sau deploy)

**Đã deploy sohoptac2: d19419e59** (2026-11-07 ~03:05 giờ VN). Backup trước deploy: `backups/20261106T195839Z` (53 MB, chỉ trên máy chủ — OFFSITE_DIR chưa đặt).
Migration chạy: hub 0105, 0106, 0109, 0110, 0111; gói contracts 0077–0081; community 0010. Sau deploy: 11 def có trigger, company_flows 9 (6 bật), cờ FLOW_TRIGGERS: 0 công ty bật (prod chạy đường cũ), 0 bài community pending+mod_screen null. Đã seed 3 mẫu Thư viện (Duyệt 2 cấp / theo giá trị / theo phòng ban, v1). admin-api + hub-api /health OK; ai., ai-admin., ai-hub., app. trả 200. sohoptac. và community. lỗi tên chứng chỉ TLS (có từ trước, deploy không đụng nginx/cert — cần kiểm riêng).

Wave cuối: int 8/8 shard xanh; e2e contracts-web đỏ lượt 2 do máy chủ quá tải (load 39/12), chạy lại xanh; journey 26/26 xanh (G1.2, G2, H2), community xanh.

## Lỗi chặn mới (quay demo 2026-11-07, chưa sửa)
- **Bước Ký số trong flow mới luôn dừng `tool_failed`:** `sendableFile` (esign.helpers.ts:75) đòi HĐ đã khoá, mà khoá = xác nhận (trigger 0048 `k1_lock_on_confirm`), chỉ xảy ra ở "Kết thúc · Đã duyệt" SAU Ký số. Đề xuất: bước Ký số tự xác nhận+khoá HĐ trước khi gửi (các bước duyệt trước đã Đạt), Kết thúc · Đã duyệt idempotent. Chặn bật cờ cho công ty có flow dùng Ký số.
- Lỗi tool bị nuốt: thẻ chỉ nói "một bước tự động gặp lỗi", không nói lý do (ESIGN_STATE/ESIGN_UNSUPPORTED_FILE/ESIGN_DISABLED).
- Ký số cần tệp PDF + cài đặt ký số của công ty bật; demo đang tải .md ⇒ cần PDF (pdf-lib).
- Đã sửa (a7e0748fb): HĐ đã gửi duyệt không còn dải "Chưa xác nhận".

## Việc kế
1. Bật cờ "Dùng quy trình mới" cho công ty Demo (Công ty › Quy trình, platform_admin) ⇒ chạy G1–G3 trên prod (người dùng đăng nhập). Rồi `flow:shadow-diff` cho NiTi = 0 ⇒ bật NiTi.
2. Video demo (local, `tools/demo/` trên nhánh slice/cr122-demo-video, worktree F:\workspace\evolu-wt\cr122-demo-video): quay lại sau các bản sửa p11d–p15 (bước 3 lưu Thông báo đã sửa ở p14; bước 5 xác nhận đã sửa).
3. R1 (nhánh slice/cr122-r1-remove-slots, 0108 có chốt an toàn + pg_dump bắt buộc): chỉ deploy khi mọi công ty đã bật cờ và so bóng xong.
4. Nợ nhỏ: Mở lại khi đã có run báo sai lý do; pending_links rỗng; push /me/stream so sai id; i18n APPROVAL_FLOW_STARTING / GROUPS_MISSING; e2e "chưa gán quy trình ⇒ lý do + Mở lại"; rà spec e2e CR-121 cũ; preview HĐ mẫu dùng hồ sơ tự nối; nút "Xác nhận và lưu" hiện trên thẻ cũ (UX).
