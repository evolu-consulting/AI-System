# UAT K1 KnowledgeHub — 2026-10-13 (tenant evolu, mock KH :4030)

Người chạy: qc-uat (Sonnet) · Evidence: commit 6ddbd5bd. Thư mục ảnh: gốc = Cài đặt, `b/` agent, `prep/` Admin, `run-sdlc/`, `run-bugfix/`, `run-degrade/`, `ui/` (mockup VI/EN, mobile).

| Kịch bản | Kết quả |
|---|---|
| Cài đặt: thêm, Kiểm tra OK, URL ngoài allowlist, `http://` bị chặn, khoá sai, tên trùng, sửa, xoá | Đạt (10/10) |
| Agent: tick/bỏ tick/lưu/tải lại; agent không phải CLI bị chặn; xoá kết nối đang dùng bị chặn | Đạt |
| Chạy `sdlc-delivery` | Một phần: 4 stage đầu qua gate, mỗi stage ghi 1 vector; dừng ở stage nhóm "Hiện thực" (`team_no_change`, giới hạn fake-cli) |
| Chạy `bug-fix` | 6/6 stage, 6 vector `kw-<run>-<stage_run>-v1`; Admin OutputDialog hiện "1/5 queries · Summary: written" |
| Hạ cấp khi KH down | Chỉ thấy `degrade` trong audit; alert vàng chỉ xem qua mô phỏng `page.route` |
| So mockup VI/EN, desktop/mobile | Lệch nhỏ |

Cách cho fake-cli gọi tool: `#fake:tool=kh-query` trong input; hit mock KH chứa sẵn các mục `## …`.

## Lỗi
**Major**
- M1. chat-web không hiện `KnowledgeNotice` trên run tuyến tính: `ProgressTab.tsx` chỉ dựng `StageRow` trong `StepSections` (run có bước song song/quay lại). E30/E31 bỏ sót vì seed có bước song song. Ảnh `run-sdlc/30-03-FAIL-A.png`, `run-bugfix/50-03-FAIL-A.png`.

**Minor**
1. Sheet "Thêm kết nối" đóng ngay sau Lưu; plan-frontend §2 yêu cầu ở lại "Đã lưu · v1".
2. Cảnh báo hạ cấp mất khi stage thử lại (notice theo attempt hiện tại; "Summary: none (writing to …)" tự mâu thuẫn).
3. Lệch mockup Cài đặt: note rủi ro xám trên bảng (mockup hộp vàng dưới), nút Xoá không đỏ, thiếu hint dưới ô Khoá, project rỗng "—" thay vì "— không ghi".
4. Lệch mockup dialog Kiểm tra: thiếu banner trạng thái màu, nút "Kiểm tra lại"/"Đóng", nhãn "Cảnh báo ·".
5. Mobile 390px: badge "hub config vN" chồng chữ; bảng kết nối cuộn ngang che nút hành động.
6. Seed sdlc-delivery/bug-fix ở evolu thiếu quyền agent (`intake-analyst`, `docs-architect`, `reviewer`, `qc`, `qc-uat`) ⇒ `permission_lost` sau gate đầu.
7. Runbook `hub:dev` thiếu `HUB_PROCESS_ENGINE=on`, `HUB_CORS_ORIGINS` gồm `http://localhost:3000`, `PUBLIC_HUB_URL` cho admin-web.

## Chưa kiểm
`KH_LIMIT` (5 lần/stage) — fake-cli chỉ gọi tool một lần mỗi job (đã có test int).

**Kết luận: Không đạt (1 Major) — sửa M1 rồi kiểm lại.**
