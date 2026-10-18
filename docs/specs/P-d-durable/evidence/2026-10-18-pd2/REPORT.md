# UAT P-d2 — báo cáo (2026-10-18, qc-uat)

**Kết luận: ĐẠT CÓ ĐIỀU KIỆN.** Không có lỗi Chặn/Cao; 4 điểm Thường (B-D2-1…4) + 2 lỗi P-d1 còn lại một phần (B4, B5). Không lộ dữ liệu tenant khác/secret.

Stack: Postgres + Redis local; stack e2e P-d dựng bằng `scripts/start-stack.mjs` ghi ở scratchpad (cùng lệnh/env với webServer `e2e/P-d/playwright.pd.config.ts`: admin-api :5301, hub-api :5302, Runtime giả :5303, chat-web :5304, admin-web :5305); **Dify giả** `scripts/fake-dify.mjs` :5390 (SSE `workflow_finished`, kịch bản ok/503/400) + secret mã hoá đúng khoá master, `admin.workflows.base_url` trỏ Dify giả ⇒ stage `tool` chạy THẬT qua pipeline Hub. Chromium 1280×800, vi-VN. Tài khoản: platform_admin (seed), `binh` (tenant_admin acme), `lan` (A), `hoa` (B, Kế toán), `q01` (H, nhóm Giám đốc). Chạy lại: `node node_modules/@playwright/test/cli.js test -c docs/specs/P-d-durable/evidence/2026-10-18-pd2/scripts/playwright.uat.config.ts` (cần stack + fake-dify đã chạy). `result.jsonl` cộng dồn nhiều lần chạy (có dòng FAIL cũ do lỗi script đã sửa).

Giới hạn: vòng nhắc/chuyển cấp của Hub chạy 300 s ⇒ chuyển cấp thật chờ tín hiệu `escalated_at` (~2 phút, đẩy `escalate_at` về quá khứ); hẹn thử lại bắn bằng đẩy `due_at`; lỗi 500 công tắc giả lập `page.route`; ô số sai (`1e`) Chromium chặn bằng bong bóng gốc.

## Bảng luồng
| Luồng | Kết quả | Evidence |
|---|---|---|
| 1 Tab "Tool quy trình": bảng, huy hiệu "Tác dụng phụ"/"Workflow đang tắt" | Đạt | F1-01 |
| 1 Bật không hỏi, toast "Đã bật tool … cho …", PUT 200 | Đạt | F1-02 |
| 1 Tắt: hộp xác nhận + câu cảnh báo, Huỷ giữ, "Tắt tool" DELETE 200 | Đạt | F1-03, F1-04 |
| 1 Tìm "Tìm tool" khớp / rỗng | Đạt (không thấy câu trạng thái rỗng bằng chữ, xem F1-06) | F1-05, F1-06 |
| 1 Lỗi bật (500 giả lập): công tắc về cũ, thông báo "Không lưu được: …" | Đạt (giả lập) | F1-07 |
| 1 tenant_admin không thấy tab, PUT API ⇒ 403 | Đạt | F1-08 |
| 2 Chọn Gọi tool + catalog (workflow tắt ẩn, tham số tệp khoá) | Đạt | F2-01, F2-02 |
| 2 Lỗi live tham số bắt buộc trống | Đạt | F2-03 |
| 2 Map tham số (trường trước / giá trị cố định), Lưu 200, tải lại giữ | Đạt | F2-04…F2-06 |
| 2 Tool tác dụng phụ: huy hiệu + gợi ý "Hành động thật" | Đạt | F2-07 |
| 2 Bật `real_action` | Không kiểm được: công tắc bị khoá vì bước trước không có người kiểm (đúng mockup E2); chưa thử trường hợp bật được | FAIL-F2e |
| 2 Tool bị tắt sau khi lưu: editor báo "(đã tắt hoặc không còn)"; Lưu bị chặn ở client, không PUT | Đạt (PROCESS_REF_INVALID dạng client) | F2-09, F2-10 |
| 3 Rẽ nhánh: thêm luật, Lưu 200, cạnh "Rẽ nhánh · luật 1", tải lại giữ, xoá luật | Đạt | F3-01…F3-08 |
| 3 Lỗi live luật ở stage đứng sau (BRANCH_INVALID) | Không kiểm được: nút "Thêm luật" khoá ở stage không có trường | FAIL-F3c |
| 4 Tool xong: .md + fields (so_hd, tong) đúng | Đạt | F4-01, F4-02 |
| 4 Rẽ nhánh khớp (25 triệu ⇒ bước 4): 2 stage "Bỏ qua", nhật ký "Rẽ nhánh: tới bước 4 (luật 1)" | Đạt | F4-01, F4-03 |
| 4 Quay lại bước 2 qua stage skipped: chạy lại, tới gate, "Đạt" ⇒ xong | Đạt | F4-04…F4-06 |
| 4 Không khớp (5 triệu): chạy tuần tự, không skipped | Đạt | F4-07 |
| 5 Lỗi tạm (Dify 503): "Đang thử lại (1/3)", bắn hẹn ⇒ tool xong | Đạt | F5-01, F5-03 |
| 5 Lỗi nghiệp vụ (400): thẻ "Gọi tool bị lỗi." + "Thêm 1 lần làm lại"/"Huỷ lượt chạy"; làm lại ⇒ xong | Đạt | F5-04, F5-05 |
| 5 side_effect, không người Đạt: tool_failed, Dify 0 lời gọi (D2-49; def dựng SQL vì editor chặn) | Đạt | F5-06 |
| 5 side_effect, có người Đạt, Dify 503: tool_failed ngay, 1 lời gọi, không thử lại | Đạt | F5-07 |
| 6 Input "Số": type=number; hợp lệ ⇒ POST `{type:number,…}` | Đạt | F6-01, F6-03, F6-04 |
| 6 Số sai: bị chặn, không POST | Đạt có điều kiện: chỉ bong bóng gốc "Please enter a number." (tiếng Anh), không có câu "Nhập một số hợp lệ." (B-D2-1) | F6-02 |

## Kiểm lại lỗi P-d1
| Mã | Kết quả |
|---|---|
| B1 TEAM_SECTION_UNOWNED live | ĐÃ SỬA (hiện ngay khi mở stage) — F7-08 |
| B2 ttl_days 400 live | ĐÃ SỬA — F7-07 |
| B3 khung luồng kẹt skeleton với run retry | ĐÃ SỬA — dòng "Đang thử lại (1/3) · Giai đoạn 1/4 · Xuất hoá đơn" — F5-02 |
| B4 trang run người khởi tạo | MỘT PHẦN: có "Đang chờ nhóm…", vẫn thiếu "Đã chuyển cấp" (cả với chuyển cấp thật) — F7-02, F7-06 |
| B5 huy hiệu + cột Giai đoạn (admin) | MỘT PHẦN: cột "Thử lại lúc…/Chờ tới…" đúng, chi tiết run "Đang chạy" đúng; DANH SÁCH vẫn huy hiệu "Đang chờ hẹn" cho run retry — F7-09, F7-10 |
| B6 copy chuyển cấp | ĐÃ SỬA với chuyển cấp thật ("Đã chuyển cấp tới nhóm Giám đốc vì chưa ai kiểm sau 24 giờ.") — F7-05 (seed SQL không có payload nhóm/giờ nên thẻ trống — không phải lỗi) |

## So mockup 04 (và 02/03)
- E1/E3 khớp: huy hiệu "Gọi tool" + "Tác dụng phụ", cạnh nét đứt "Rẽ nhánh · luật 1", khối luật 4 cột, "Hợp lệ" (F2-07, F3-06).
- D-1: nhãn "Thông tin đầu vào"/"Kết quả giai đoạn trước" khớp; ô khoá real_action có mô tả khớp E2.
- D-2: mockup E4 hiện chip "Rẽ nhánh: luật n tới bước m" ở chế độ Danh sách và cột trạng thái "Bỏ qua" ở trang run admin — chưa kiểm (không thuộc luồng đã chạy).
- D-3 (B5): list lượt chạy admin "Đang chờ hẹn" cho retry, mockup 03 D1 mong "Đang chạy".

## Lỗi
| # | Mức | Mô tả | Tái hiện | Evidence |
|---|---|---|---|---|
| B-D2-1 | Thường | Số sai chỉ có bong bóng gốc tiếng Anh; câu "Nhập một số hợp lệ." (D2-44) không bao giờ hiện vì trình duyệt coi value rỗng | `!uat-num` gõ `1e` ⇒ Bắt đầu | F6-02 |
| B-D2-2 | Thường | Lưu def có tool đã tắt bị chặn ở client, không có PUT ⇒ không thấy mã PROCESS_REF_INVALID từ server | F2f | F2-10 |
| B-D2-3 | Thường | Danh sách Lượt chạy admin: run retry hiện "Đang chờ hẹn" (còn từ B5) | Lượt chạy Hoá đơn T | F7-09 |
| B-D2-4 | Thường | Trang run người khởi tạo thiếu "Đã chuyển cấp" (còn từ B4) | uat-esc, A mở /runs/<id> sau chuyển cấp | F7-06, FAIL-B4r |
Ghi chú: Hub vòng nhắc/chuyển cấp 300 s — không phải lỗi, nhưng UAT phải chờ.
