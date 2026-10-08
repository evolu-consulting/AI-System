# X2a · I2 — Hướng dẫn kiểm tay chat user↔user (2 trình duyệt)

Dành cho **người dùng**. Phạm vi: spec [`spec.md`](spec.md) §5, AC ở §8. Mọi lệnh chạy ở gốc repo `D:\AI\ai-system`. Không cần Runtime WSL, Dify hay `claude-sub` (chỉ chat người với người).

## 1. Bật hệ thống
1. Docker Desktop đang chạy; có `.env.local` (chép từ `.env.example`, điền `SEED_ADMIN_PASSWORD`); `bun install` lần đầu.
2. Terminal 1:
```
docker compose up -d --wait
bun run hub:dev
```
Chờ dòng `[hub-dev] sẵn sàng: HUB_URL=http://localhost:4000 AUTH_URL=http://localhost:3001`. Bước này tự migrate (0011–0013), tạo tenant/user và phòng mẫu (idempotent, chạy lại không nhân đôi). Chi tiết: `tools/hub-dev/README.md`, `docs/guides/hub-dev.md`.
3. Terminal 2 (chat-web trỏ vào Hub thật; mặc định của chat-web là mock `:4020` nên **phải** đặt 2 biến):
   - PowerShell: `$env:HUB_URL="http://localhost:4000"; $env:AUTH_URL="http://localhost:3001"; bun run --cwd apps/chat-web dev`
   - Git Bash: `HUB_URL=http://localhost:4000 AUTH_URL=http://localhost:3001 bun run --cwd apps/chat-web dev`
4. Mở **http://localhost:3100**. (Thay thế: `bun run combine:dev` dựng cả 5 tiến trình, đã đặt đúng biến — xem `docs/guides/combine-test.md`; nặng hơn mức cần.)

## 2. Tài khoản và dữ liệu mẫu
Tenant `evolu` (ô tenant khi đăng nhập), mật khẩu `1234567890`: `julian.bui` (tenant_admin, chủ "Evolu team"), `thomas.tran`, `vio.ngo`, `edgar.nguyen`, `rowan.hoang`.
Phòng mẫu: nhóm **"Evolu team"** (5 người) và DM **Julian–Thomas**; chưa có tin.

**Hai trình duyệt:** cửa sổ thường = **A** (`julian.bui`), cửa sổ ẩn danh = **B** (`thomas.tran`). Khi cần người thứ 3 dùng `vio.ngo` ở cửa sổ ẩn danh khác (hoặc đăng xuất B). Cookie đăng nhập dùng chung theo trình duyệt nên không dùng 2 tab cùng cửa sổ.

## 3. Kịch bản (đánh dấu Đạt / Lỗi vào bảng §4)
| # | Làm gì | Kỳ vọng |
|---|---|---|
| 1 | A và B đăng nhập. Sidebar thấy mục **"Tin nhắn & Nhóm"** (Evolu team, DM) và mục **"Hỏi AI"**; không có panel agent bên phải, không hàng chip agent | Đúng như mô tả (AC15) |
| 2 | A mở DM với Thomas, gửi "xin chào". B đang ở màn khác | B thấy tin xuất hiện ≤ 2 giây, huy hiệu chưa đọc **1** trên DM, **tổng chưa đọc** tăng 1 |
| 3 | B mở DM đó | Huy hiệu về 0, tổng giảm; A thấy "**Đã xem**" dưới tin cuối của mình |
| 4 | B trả lời; A đang mở DM | Tin của B hiện ngay ở A; B thấy "Đã xem" khi A đang xem (hai chiều) |
| 5 | A cuộn lên giữa lịch sử, B gửi thêm tin | A thấy pill "n tin mới", bấm thì cuộn xuống; huy hiệu không tăng khi A đang xem cuối |
| 6 | A bấm "Nhóm mới": đặt tên "Test nhóm", chọn Thomas + Vio, bấm "Tạo nhóm" | Nhóm hiện ở A và B ngay; đếm "n / 50 · gồm bạn"; A là chủ nhóm |
| 7 | A gửi tin trong nhóm | B (và Vio) nhận realtime, huy hiệu +1; "Đã xem bởi n" cập nhật |
| 8 | A thêm Edgar vào nhóm (Thêm người) | Edgar thấy **toàn bộ lịch sử** nhóm kể cả tin trước khi vào |
| 9 | A bớt Edgar | Edgar mất nhóm khỏi danh sách; mở lại đường dẫn nhóm → "Không tìm thấy" (404), không còn nhận tin |
| 10 | A đổi tên nhóm thành "Test nhóm 2" | B thấy tên mới (realtime hoặc sau tải lại) |
| 11 | B (không phải chủ) thử mở menu | Không có đổi tên/xoá/thêm người; có "Rời nhóm" |
| 12 | A chuyển chủ cho Thomas (Quản lý thành viên) | Thomas thành chủ; A hết quyền quản lý |
| 13 | Chủ mới (B) thử rời nhóm khi còn người | Bị yêu cầu chuyển chủ trước (OWNER_MUST_TRANSFER); chuyển cho Vio rồi rời được |
| 14 | A rời nhóm (không còn là chủ) | Nhóm biến mất khỏi sidebar A; người còn lại thấy A rời |
| 15 | Chủ hiện tại (Vio hoặc B) xoá nhóm | **Các thành viên khác bị đẩy ra** khỏi màn nhóm, có toast thông báo xoá; nhóm biến khỏi sidebar |
| 16 | A ẩn DM Julian–Thomas (menu DM: "Ẩn hội thoại") | DM mất khỏi sidebar A, B vẫn thấy. Rồi B gửi tin mới → DM **hiện lại** ở A kèm chưa đọc 1 |
| 17 | Mất mạng: B tắt mạng (DevTools → Network → Offline, hoặc tắt Wi-Fi) ~15 giây; trong lúc đó A gửi 2 tin; B bật lại mạng | B thấy banner "Đang kết nối lại…", sau khi nối lại banner mất, **đủ 2 tin, không mất, không lặp**; chưa đọc đúng |
| 18 | A bấm "Tin nhắn mới" / ô tìm, gõ "rowan" | Chỉ hiện người **cùng tenant** (không email/role); chọn Rowan → mở DM (nếu đã có thì mở DM cũ, không tạo thêm) |
| 19 | Tìm người không dấu "Cuc" cho tên có dấu | Dự kiến **không khớp** (giới hạn đã biết, TECH-DEBT #102) — không tính là lỗi |
| 20 | A gõ `@assistant` trong phòng | Chỉ là chữ thường, không có menu `@`/`/`, không chạy agent (X2b mới làm) |
| 21 | Tải lại trang (F5) ở phòng đang mở; thử mở `/rooms/<id-bậy>` | Phòng giữ nguyên, lịch sử còn; id bậy → "Không tìm thấy" |
| 22 | Hỏi AI (mục "Hỏi AI"): mở hội thoại cũ | Hội thoại C1 vẫn hoạt động như trước (cần Runtime mới có trả lời; chỉ kiểm danh sách hiện) |

Mobile (tuỳ chọn): thu cửa sổ < 768 px — phòng toàn màn, sidebar thành màn danh sách.

## 4. Ghi kết quả
Ghi vào [`spec-decisions.md`](spec-decisions.md) mục **B. Kết quả kiểm tay I2**, mỗi dòng: `YYYY-MM-DD [tên] bước <số> — Đạt/Lỗi: <mô tả, ảnh/chụp nếu có> — mức (Chặn/Cao/Thường)`. Lỗi kèm: tài khoản, trình duyệt, giờ (để tra log hub-api). Không cần ghi các bước đạt riêng lẻ; ghi một dòng "bước 1–22 đạt trừ …". Xong thì báo điều phối: lỗi Chặn/Cao → sửa trước X2b; còn lại vào `docs/TECH-DEBT.md`.

## 5. Dừng / dọn
`Ctrl+C` ở cả hai terminal; `docker compose down` nếu muốn tắt hạ tầng. Chạy lại `hub:dev` không mất phòng (dữ liệu giữ trong DB `ai_system`).
