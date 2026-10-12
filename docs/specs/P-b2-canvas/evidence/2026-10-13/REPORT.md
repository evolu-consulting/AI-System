# UAT P-b2-canvas — 2026-10-13

qc-uat (Chromium headless, Playwright qua `node`). Code HEAD ≥ `4a398170`. Kết luận: **toàn bộ ca nghiệp vụ Đạt, kể cả 7 ca resume Claude thật (G-7)**. Không có lỗi Chặn/Cao do P-b2; 6 lỗi Thường/Thấp (L1–L6).

## Stack
- Hub `hub:dev` với `HUB_DEV_RUNTIME=none HUB_PROCESS_ENGINE=on`, migration 0024/0025 đã áp.
- admin-web :3000 (`PUBLIC_HUB_URL=http://localhost:4000`), chat-web :3100 (`AUTH_URL=http://localhost:3001`).
- Runtime: WSL Ubuntu user `worker`, providers `claude-sub,fake-cli`, Claude đã đăng nhập; container `ai-hub-dev-runtime` tắt để khỏi tranh job.
- Tenant `evolu`: `julian.bui` (tenant_admin), `thomas.tran` (người bắt đầu), `vio.ngo`, `edgar.nguyen` (Group kiểm). Dữ liệu UAT: agent `pb2-claude`, 5 quy trình `pb2-uat-*` (còn trong DB dev).

## Ca
| Ca | Nội dung | Kết quả | Ảnh |
|---|---|---|---|
| A01–A02 | Editor, tab Canvas/Danh sách | Đạt | `01-A-canvas-initial`, `02-A-list-mode` |
| A03 | Kéo stage sang bước 2 | Đạt | `03-A-after-drag` |
| A04–A06 | Alt+←/→/↑, bước đầy báo lỗi, `aria-disabled`, giữ focus | Đạt | `04-A-three-parallel`, `05-A-step-full-error` |
| A07–A08 | "Nếu bị trượt → quay lại bước 1", lưu/tải lại; Hub tự thêm "Bàn giao" | Đạt | `07-A-back-edges`, `08-A-reloaded` |
| A09 | 422 theo stage (ép request, Hub trả 422 thật) | Đạt, lỗi L2 | `09-A-422-per-stage` |
| A10 | Chỉ xem (mẫu `!sdlc`) | Đạt | `10-A-readonly-template` |
| A11 | Mobile 390 px | Đạt, lỗi L4 | `11-A-mobile-click-390` |
| A12 | EN | Đạt, lỗi L5 | `12-EN-admin-canvas` |
| C01 | StageStrip theo bước, nhóm song song | Đạt | `01-A-room-strip-step1` |
| C02 | Stage bước 1 không có lựa chọn quay lại | Đạt | `02-B-stage1-fail-no-back` |
| C03 | Đạt một stage chỉ đóng task stage đó | Đạt | `03-B-run-step2-two-cards` |
| C04 | Panel "Quay lại bước 1", góp ý bắt buộc, "Còn 3 lần…" | Đạt | `04-C-fail-panel-back` |
| C05 | ×2 và vệt quay lại | Đạt | `05-A-room-strip-x2` |
| C06 | Trang Run: BackTimeline, tab Bản 1/Bản 2 | Đạt | `06-A-run-page-timeline` |
| C07 | Quá 3 lần → `back_limit`; thêm lượt (`back_limit`=4) | Đạt | `07-A-back-limit-card` |
| C08 | Huỷ run khi nhánh Claude thật còn chạy | Đạt (lần 1 lỗi script, chạy lại sạch 8/8) | `08-A-before-cancel`, `08-A-after-cancel` |
| C09 | Trang Run EN | Đạt, lỗi L5 | `12-EN-chat-run` |

## Resume Claude thật (G-7) — bằng chứng `g7-claude*-jobs.txt`
| Ca | Kết quả |
|---|---|
| G1 Chưa đạt cùng agent | Đạt: prompt chỉ "Góp ý cần sửa:…", `use_session=true`, `session_id` giữ nguyên |
| G2 Hỏi lại + trả lời | Đạt: cùng `session_id`, prompt có khối "Câu hỏi trước / Trả lời" |
| G3 Stage sau cùng agent | Đạt: hàng cũ xoá, phiên mới |
| G4 Hai stage cùng bước cùng agent | Đạt: `use_session=false`, không có `cli_sessions` |
| G5 `provider_key` | Đạt phần chính (`claude-sub`, bước 0); chưa kiểm provider dự phòng |
| G6 Bàn giao trong prompt | Đạt (~35 token, ≤200); cắt >200 chưa kiểm trên Claude thật |
| G7 Phiên quá hạn | Đạt: prompt đầy đủ, phiên mới |

## Lỗi
| # | Mức | Ở đâu | Mô tả |
|---|---|---|---|
| L1 | Thường (có sẵn từ P-a) | `contracts/src/hub-admin/processes.ts:78` `STAGE_KEY_RE {1,32}` vs `contracts/src/chat/processes.ts:5` `PROCESS_KEY_RE {2,32}` | Stage key 1 ký tự lưu/chạy được nhưng trang Run báo "Không tải được." (view không qua schema) |
| L2 | Thường | admin-web panel stage | 422 chỉ đỏ nút/ô "Chạy ở bước"; stage chỉ lỗi BACK_TARGET_INVALID không có dòng giải thích, không có `role="alert"` |
| L3 | Thường | admin-web canvas `fitView` | Chữ ~6–7 px khi 4–8 bước dù khung còn trống dọc; mũi tên quay lại đè tiêu đề cột |
| L4 | Thường | admin-web < 1024 px | Plan ghi panel là `Sheet`; thực tế inline dưới danh sách, không cuộn tới ⇒ bấm stage như không phản hồi |
| L5 | Thấp | chat-web EN | "×5" kèm "Redone 5 time(s)" — round 5 = làm lại 4 lần |
| L6 | Thấp | admin-web Alt+← | Stage chuyển sang bước trước được chèn đầu cột đích ⇒ số "Giai đoạn n" khác đổi |

## Giới hạn
Chỉ Chromium; chat-web không kiểm mobile; A09 mô phỏng; G1–G4, G7 lái qua API Hub bằng JWT người dùng. Chưa UAT trình duyệt: hai người duyệt cùng quay lại (có int), Bàn giao >200 token bị cắt, provider dự phòng, quota.

Chạy lại: trong `scripts/`: `node reset-edit.mjs && node admin.mjs && node chat.mjs` (`ONLY=C08` chạy riêng một ca).
