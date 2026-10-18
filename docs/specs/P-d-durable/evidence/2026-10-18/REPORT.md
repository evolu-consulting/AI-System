# UAT P-d1 — báo cáo (2026-10-18, qc-uat)

**Kết luận: ĐẠT CÓ ĐIỀU KIỆN.** Không có lỗi Chặn/Cao; 6 lỗi Thường (B1–B6), 7 điểm so mockup (D1–D7).

Stack: Postgres + Redis local; stack e2e P-d (admin-api :5301, hub-api :5302, Runtime giả :5303, chat-web :5304, admin-web :5305) do Playwright `webServer` dựng. Chromium 1280×800, vi-VN. Tài khoản: platform_admin (seed), `binh` (tenant_admin acme), `lan` (A, người khởi tạo), `q01` (H, thành viên nhóm "Giám đốc"). Script chạy lại: `node node_modules/@playwright/test/cli.js test -c docs/specs/P-d-durable/evidence/2026-10-18/scripts/playwright.uat.config.ts` (cần Node trên PATH).

Giới hạn: stack e2e không có đồng hồ giả/handle `sweepOnce` cho trình duyệt — "bắn hẹn" bằng cách đẩy `due_at` về quá khứ rồi chờ tín hiệu DB (vòng nền Hub thật bắn, không sleep); retry / retry_exhausted / timer_invalid / chuyển cấp dựng bằng SQL như e2e; múi giờ lạ (400) giả lập bằng `page.route`; ngày không có thật (30/02) Chromium tự chặn.

## Bảng luồng

| Luồng | Kết quả | Evidence |
|---|---|---|
| 1a Múi giờ: xem (chỉ đọc) | Đạt | F1-01 |
| 1b Bộ chọn múi giờ, gõ "ber" | Đạt | F1-02, F1-03 |
| 1c Chọn Europe/Berlin, Lưu 200, tải lại giữ | Đạt (lệch nhỏ D1, D2) | F1-04…F1-06 |
| 1d Múi giờ lạ (400) ⇒ alert đúng câu | Đạt (giả lập) | F1-07 |
| 1e Tìm không khớp | Đạt | F1-08 |
| 2a Stage "Chờ tới ngày": nguồn ngày, chênh lệch, giờ, múi giờ công ty | Đạt | F2-02…F2-05 |
| 2b Lưu 200 + huy hiệu "Chờ tới ngày" trên canvas | Đạt | F2-06 |
| 2c Nhắc N giờ + chuyển cấp nhóm Giám đốc, lưu, tải lại giữ | Đạt | F2-07…F2-10 |
| 2d Lỗi live nhắc/chuyển cấp ngoài 4–168 | Đạt | F2-11 |
| 2e ttl_days 30 / "Không hết hạn" | Đạt | F2-12, F2-13 |
| 2f ttl_days 400 ⇒ "Từ 1 đến 365 ngày" | Đạt có điều kiện: chỉ hiện sau Lưu (B2) | F2-14, F2-14b |
| 2g WAIT_INVALID nguồn cùng bước | Đạt | F2-15 |
| 2h TEAM_SECTION_UNOWNED (team sequential) | Không đạt dạng live: chỉ hiện sau Lưu (B1) | F2-16, F2-17, FAIL-F2i |
| 3a Form `!pd-wait-input`: date hợp lệ ⇒ 201, dải "Chờ tới …", huy hiệu "Đang chờ hẹn", dòng trạng thái | Đạt | F3-01, F3-04…F3-07 |
| 3b Ô ngày trống ⇒ không chặn, run vào "Cần người quyết" | Đạt (đúng mockup) | F3-02 |
| 3c Ngày sai 30/02 | Không kiểm được trên server (Chromium chặn) | F3-03 |
| 3d Ngày quá hạn lượt chạy ⇒ thẻ "Ngày hẹn không hợp lệ…" | Đạt | F3-09 |
| 3e Bắn hẹn ⇒ stage 0 done, stage 1 running | Đạt | F3-08 |
| 3f "Đang thử lại (2/3)" trên dải trang run | Đạt | F3-10 |
| 3g "Đang thử lại" ở dòng trạng thái khung luồng trong phòng | Chưa xác nhận: panel kẹt skeleton (B3) | F3-11, FAIL-F3c1 |
| 3h retry_exhausted: thẻ quyết, "Thử lại ngay" ⇒ chạy lại | Đạt | F3-12, F3-14 |
| 3i timer_invalid: thẻ quyết 3 nút | Đạt | F3-13 |
| 3j Chuyển cấp: Inbox H có thẻ + "Đã chuyển cấp"; H bấm "Đạt" được | Đạt (lệch copy D5) | F3-15, F3-17 |
| 3k Người khởi tạo thấy "Đã chuyển cấp" / dòng chờ nhóm ở trang run | Không đạt (B4, có thể do seed) | F3-16 |
| 4 Admin run view: danh sách + chi tiết waiting/retrying | Đạt có lệch (B5) | F4-01…F4-04 |

## So mockup

- D1 (mockup 02 B1): thanh lưu ghi "Chưa lưu thay đổi", mockup "Có thay đổi chưa lưu". Thường.
- D2 (mockup 02 B2): chọn Berlin xong popover vẫn mở với danh sách không lọc ("Còn 367 kết quả"); mockup đóng lại (F1-04). Thường.
- D3 (mockup 01 A4): lỗi ttl_days không hiện live (B2); lỗi nhắc/chuyển cấp live đúng mockup.
- D4 (mockup 03 D1 chờ hẹn): dải, huy hiệu, dòng trạng thái, chấm vòng — khớp (F3-06).
- D5 (mockup 03 D4): thẻ chuyển cấp ở Inbox thiếu chủ ngữ, thiếu đoạn "Việc này được chuyển cấp tới nhóm … vì chưa ai kiểm sau N giờ…", thiếu dòng "Đang chờ nhóm … (đã chuyển cấp)", thiếu mục nhật ký "Hệ thống chuyển cấp…" (một phần có thể do payload seed) — F3-15, F3-16.
- D6 (mockup 03 D1 retry): mockup huy hiệu "Đang chạy" khi thử lại; admin hiện "Đang chờ hẹn" (F4-01, F4-04). Nhãn "Đang thử lại (2/3) · 16:31" ở bảng giai đoạn đúng.
- D7 (mockup 03 D2): copy thẻ quyết retry_exhausted / timer_invalid khớp (F3-12, F3-13).
- Không tính lỗi: "09:00 AM", "mm/dd/yyyy" là định dạng Chromium theo máy.

## Lỗi

| # | Mức | Mô tả | Tái hiện | Evidence |
|---|---|---|---|---|
| B1 | Thường | TEAM_SECTION_UNOWNED không hiện live khi mở/sửa stage; chỉ hiện sau Lưu (client chặn, không PUT) | team `mode=sequential` thành viên giữ "Phần B"; def `uat-team` stage team `required_sections=["Kết quả"]`; mở stage ⇒ không lỗi; Lưu ⇒ lỗi | F2-16, F2-17 |
| B2 | Thường | `ttl_days`=400 không báo live; "Từ 1 đến 365 ngày" chỉ sau Lưu | def `pd-edit` ⇒ Thông tin ⇒ gõ 400 | F2-14, F2-14b |
| B3 | Thường (chưa chắc) | Khung luồng trong phòng kẹt skeleton với run retry dựng bằng SQL | `seedTimerRun(room,"retry")` ⇒ `/rooms/<id>?flow=<run>` | F3-11, FAIL-F3c1 |
| B4 | Thường (chưa chắc) | Trang run của người khởi tạo không hiện "Đã chuyển cấp"/dòng chờ nhóm | `seedEscalated` ⇒ A mở `/runs/<run>` | F3-16 |
| B5 | Thường | Admin: run retry hiện huy hiệu "Đang chờ hẹn"; cột "Giai đoạn" chỉ "1/2" | Admin ⇒ Quy trình ⇒ Hoá đơn T ⇒ Lượt chạy | F4-01, F4-04 |
| B6 | Thường | Copy thẻ chuyển cấp trong Inbox thiếu chủ ngữ/giải thích (D5) | Inbox H sau `seedEscalated` | F3-15 |

Mockup 04 (P-d2) bỏ qua theo phạm vi.

Ghi chú điều phối: file này do phiên chính ghi từ báo cáo của agent qc-uat (harness không cho subagent ghi file báo cáo).
