# Test plan · P-d · e2e tối thiểu (phụ lục của [test-plan.md](test-plan.md))

Playwright, config `e2e/P-d/playwright.pd.config.ts` (đặt dưới `e2e/**/playwright*.config.ts` để `bun run test:all` tự nhận — CLAUDE.md Luật 4b), stack + seed như `e2e/P-c2` (`_pc2-support.ts`: hub-api + admin-api + web thật, runtime giả, `seedRun`). Chọn phần tử bằng **role + nhãn nguyên văn**; nhãn dưới đây lấy từ spec §6, spec-d2 §6, spec-tz-tools §1–§2 — **chốt lại theo `plan-frontend.md` (T2/T14, chưa có)**; nhãn nào plan-frontend đổi thì qc sửa test-plan trước khi viết test (Q7). Sau lưu: chờ `page.waitForResponse` (bẫy CONVENTIONS §2). Trạng thái chờ hẹn/thử lại dựng bằng SQL seed (stage `waiting_timer` + hàng `process_timers`), không chờ thời gian thật.

## 1. P-d1
| Ca | AC/FR | File | Persona · bước | Kỳ vọng |
|---|---|---|---|---|
| PD-E01 | ADM-FR-71 · AC-H41 | `e2e/P-d/admin-stage.pd.ts` | `tadmin` mở `/processes/:id` canvas ⇒ panel stage ⇒ executor "Chờ tới ngày": nguồn "Trường của bước trước" `ngay_het_han`, "−3" ngày, giờ "09:00" ⇒ Lưu ⇒ tải lại | panel hiện dòng chỉ-đọc **"Theo múi giờ công ty: Asia/Ho_Chi_Minh"**; sau tải lại giữ đủ giá trị; `PUT /process-defs/:id` 200 |
| PD-E02 | AC-H42 | ″ | khối gate: "Nhắc mỗi" 4 "giờ", "Chuyển cấp sau" 24 "giờ tới Group" "Giám đốc" ⇒ Lưu ⇒ tải lại; chọn Group = Group duyệt ⇒ Lưu | giữ giá trị; lỗi inline theo `rules[]` `ESCALATE_INVALID` trên ô chuyển cấp, không đóng panel |
| PD-E03 | AC-H43 | ″ | form quy trình: "Thời hạn run (ngày)" 30 ⇒ Lưu; bật "Không hết hạn" ⇒ Lưu ⇒ tải lại | ô ngày ẩn/khoá khi "Không hết hạn"; tải lại giữ `ttl_days:null` |
| PD-E04 | AC-H41 | ″ | đổi stage "Chờ tới ngày" sang `after` "Cần duyệt" ⇒ Lưu | lỗi inline `WAIT_INVALID` |
| PD-E05 | AC-A14 · ADM-FR-72 | `e2e/P-d/admin-tenant.pd.ts` | `padmin` `/tenants/:acme` tab "Thông tin" ⇒ ô chọn có tìm kiếm "Múi giờ" gõ "Berlin" ⇒ chọn `Europe/Berlin` ⇒ Lưu ⇒ tải lại; `tadmin` mở `/tenants` | giá trị hiện mặc định `Asia/Ho_Chi_Minh` lúc đầu; sau lưu giữ `Europe/Berlin`; `tadmin` không vào được màn tenant (B3) |
| PD-E06 | CHAT-AC-59 · AC-H39 | `e2e/P-d/chat-labels.pd.ts` | A mở thread run seed: stage `waiting_timer` hẹn `retry`, `retry_count` 2 | StageStrip ô stage hiện **"Đang thử lại (2/3)"** |
| PD-E07 | CHAT-AC-59 · AC-H41 | ″ | run seed stage `wait_until` chờ tới `2026-11-17T02:00Z` (HCM); run `waiting_timer` | ô stage **"Chờ tới 17/11/2026"** (định dạng ngày theo plan-frontend); nhãn run **"Đang chờ hẹn"** |
| PD-E08 | CHAT-AC-59 · AC-H39/H41/H42 | ″ | run seed `needs_decision` `retry_exhausted` / `timer_invalid`; task review đã chuyển cấp; form `!pd-wait-input` | region "Cần người quyết" phụ đề **"Hết lượt thử lại"** / **"Ngày hẹn không hợp lệ"** (thẻ timer_invalid có nút "Dùng bản hiện có"); Inbox nhãn **"Đã chuyển cấp"**; ô input kiểu `date` (`<input type=date>`) gửi được |

## 2. P-d2 (T15)
| Ca | AC/FR | File | Bước | Kỳ vọng |
|---|---|---|---|---|
| PD2-E01 | AC-H44 · ADM-FR-71 | `admin-stage.pd.ts` | panel stage executor **"Gọi tool"**: chọn `xuat-hoa-don`, map `tong_tien` ← trường bước trước, `ma_kh` ← hằng ⇒ Lưu ⇒ tải lại; tenant chưa bật tool nào | giữ map; tool `side_effect` có nhãn "Tác dụng phụ"; danh sách rỗng ⇒ **"Chưa có tool nào được bật cho công ty — liên hệ quản trị nền tảng"** |
| PD2-E02 | AC-H45 | ″ | khối **"Rẽ nhánh"**: thêm luật `tong_tien` "≥"/">" 20000000 "tới bước" 4 ⇒ Lưu | canvas vẽ mũi tên nét đứt tới cột bước 4 (role/nhãn theo plan-frontend); tải lại giữ luật |
| PD2-E03 | AC-A15 · ADM-FR-73 | `admin-tenant.pd.ts` | `padmin` tab **"Tool quy trình"** ⇒ bật công tắc `xuat-hoa-don` ⇒ tắt (hộp xác nhận) | công tắc `role=switch` theo tên workflow; nhãn "Workflow đang tắt" khi `enabled=false`; hộp xác nhận **"Run đang chờ gọi tool này sẽ dừng ở Cần người quyết"**; `PUT`/`DELETE` 200 |
| PD2-E04 | CHAT-AC-59 · AC-H45/H47 | `chat-labels.pd.ts` | run seed: stage `skipped`; run `needs_decision` `tool_failed` | ô stage **"Bỏ qua"**; region "Cần người quyết" phụ đề **"Gọi tool lỗi"**; thread có tin **"Rẽ nhánh: tới bước 4 (luật 1)"** |
| PD2-E05 | AC-H47 | `admin-stage.pd.ts` | tenant beta (`tadmin_beta`) mở editor | không thấy `xuat-hoa-don` trong danh sách "Gọi tool" |
