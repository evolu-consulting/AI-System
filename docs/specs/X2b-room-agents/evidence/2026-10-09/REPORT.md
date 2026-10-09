# UAT X2b-room-agents — 2026-10-09 (qc-uat, Sonnet)

Code HEAD `7e99f80e`. Agent THẬT: claude-sub (Runtime WSL) + Dify thật. Không Runtime giả, không sửa DB.

## Stack
`./start.sh --kill-orphan` (SKIP_CLAUDE_CHECK=1; claude -p trong WSL đã tự kiểm OK): Docker + combine:dev (admin-web :3000, chat-web :3100, studio :3200, admin-api :3001, hub-api :4000) + Agent Runtime WSL. Chromium, `locale vi-VN`, 3 context desktop 1280x800.

## Tài khoản / ánh xạ vai (tenant evolu)
Agent của evolu: consultant, dify-chatbot, invoices (+ orchestrator, không nằm trong menu `@`). Ban đầu cả 5 người có đủ 3 agent. Để B khác A/C: thu hồi `invoices` của Thomas qua UI Admin (Agents -> Cấp quyền · Invoices), khôi phục cuối buổi.
- A = julian.bui (consultant, dify-chatbot, invoices) · B = thomas.tran (consultant, dify-chatbot; KHÔNG invoices) · C = vio.ngo (đủ 3).
- `hoadon` trong manual-test -> `invoices`; `trello` -> `consultant`/`dify-chatbot`.

## Thay đổi quyền (qua UI Admin, julian.bui) và khôi phục
| Thay đổi | Ảnh | Khôi phục |
|---|---|---|
| Thu hồi invoices của Thomas (5 -> 4 người), trước bước 2/5 | `perm-revoke-invoices-ThomasTran.png` | Đã khôi phục cuối buổi: 5 người (Edgar, Julian, Rowan, Thomas, Vio) — kiểm lại trên bảng Agents, `perm-restore-invoices-ThomasTran.png` |
| Thu hồi invoices của Vio (bước 15) | `perm-revoke-invoices-VioNgo.png` | Đã khôi phục ngay trong bước (`finally`), 4->5 người, `perm-restore-invoices-VioNgo.png` |
Phòng tạm "UAT X2b …" (6 phòng) đã xoá qua UI cuối buổi; "Evolu team" và DM giữ nguyên.

## Kết quả 17 bước
| # | Kết quả | Ghi chú / ảnh |
|---|---|---|
| 1 | PASS | A: 3 option (consultant, dify-chatbot, invoices), không panel/chip — `01-A-menu-at` |
| 2 | PASS | B: 2 option, không invoices; `@orchestrator` không nằm trong menu — `02-B-menu-at` |
| 3 | PASS | invoices thật: B/C thấy "đang xử lý…", B không có Dừng ("Chỉ Julian Bui dừng được"), khối "Julian Bui hỏi" cho cả 3 — `03-*` |
| 4 | PASS | A Dừng -> "Đã huỷ" cho cả 3 — `04-*` |
| 5 | PASS | B `@invoices`: "Không tìm thấy agent @invoices.", ô giữ chữ, không tin/run — `05-B-denied` |
| 6 | PASS | C `@invoices`: "Chạy bằng quyền của Vio Ngo" — `06-A-vio-run` |
| 7 | PASS | 2 khối song song, ALPHA (A, consultant) / BETA (C, invoices) không lẫn — `07-*` |
| 8 | PASS | Thread chung, B/C có composer, tin B không tạo run — `08-*` |
| 9 | PASS | B `@consultant` trong thread: "Chạy bằng quyền của Thomas Tran", A thấy; B `@invoices` bị từ chối, giữ chữ — `09-*` |
| 10 | PASS | Ép được need_input bằng `@orchestrator giúp tôi với` (Orchestrator hỏi lại + chip chọn): A có chip, B chỉ "Đang chờ Julian Bui trả lời agent." không nút — `10-*` (không thử B forge answer_run_id qua API) |
| 11 | BỎ QUA | side_effect cần workflow ghi + xác nhận; không ép được với agent thật |
| 12 | PASS | `@orchestrator`: khối nhãn "Orchestrator", trả lời "1+1 bằng 2." — `12-*` |
| 13 | PASS | Không nút đính kèm/input file — `13-A-no-attach` |
| 14 | PASS | 14a B rời nhóm khi run chạy: run dừng, không tin "Đã huỷ" (đúng spec R17/Q8); 14b chủ xoá nhóm khi C chạy: phòng biến mất cho A và C — `14a-*`, `14b-*` (bị bớt: không thử) |
| 15 | PASS | UI Admin thu hồi invoices của C: gọi lại bị từ chối ngay (161 ms), ô giữ chữ — `15-C-revoked-denied` |
| 16 | PASS | F5 A và B giữa run: khối "đang xử lý" còn, kết quả 1 khối, tin không lặp — `16-*` |
| 17 | PASS (phần phòng) | `/c/new` không lẫn tin phòng. `@dify-chatbot` ở Hỏi AI và trong phòng: Dify thật lỗi UPSTREAM_ERROR (xem Lỗi 2) — `17-A-dify-reply`, `17b-*` |

Lần chạy đầu: bước 1, 2 FAIL do lỗi script (locale EN sau đăng nhập; assertion `hasText "orchestrator"` khớp mô tả consultant) và 14b FAIL do lỗi script (nút "Xoá", run xong trước khi xoá). Đã sửa script, chạy lại riêng các bước đó (`result-rerun.json`, `result-rerun-02.json`); ảnh FAIL cũ ở `first-run/`.

## Agent/Dify thật
Tổng tin gọi agent/Dify thật: 14 (lần chạy chính 12 + chạy lại 14b và 17b = 2). Dify thật: bước 17 và 17b. Bước 5, 9 (B @invoices) và 15 là từ chối, không tốn agent.

## Lỗi tìm thấy
1. **Thường** — Xem trước phòng ở sidebar: tiền tố người gửi hiện UUID thô thay vì tên agent cho tin agent (Orchestrator: `01a11c1d-ca4e-…` là tenant id; consultant: `42301940-…`), trong khi Chatbot (Dify) và tải tin trực tiếp hiện tên. Ảnh `02-FAIL-1.png` (sidebar bên trái), `first-run/14b-FAIL-0.png`. Nghi: nơi dựng `last_message` preview của phòng (hub-api rooms list) không ánh xạ sender agent -> tên.
2. **Cao (môi trường Dify, chưa chắc lỗi X2b)** — `@dify-chatbot` thật trả "Dịch vụ AI đang gặp sự cố / Agent không trả lời được", `UPSTREAM_ERROR` sau ~21 s (log `dify-agent-failed … reason upstream`, run f6af4d50…), cả Hỏi AI và phòng. Nghi cấu hình/khoá/URL Dify (`DIFY_BASE_URL` trong .env.local) hoặc app Dify; chưa kiểm được phía Dify (không dùng console). Ảnh `17-A-dify-reply`, `17b-A-dify-room`.
3. Lưu ý nhỏ (không chắc là lỗi): bước 14a người ở lại không thấy khối "Đã huỷ" — đúng spec, ghi lại để biết.

## Giới hạn
Không thử: forge answer_run_id (B), side_effect (11), "bị bớt khỏi nhóm", đứt kết nối thật, trình duyệt ngoài Chromium, 390px. Hộp Hỏi AI của Thomas có sẵn một hội thoại "@invoices Bạn kiểm tra đ…" không do UAT này tạo.
