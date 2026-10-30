---
id: ops-watch
cr: CR-104
trạng thái: đã duyệt 2026-10-30
ngày: 2026-10-30
---
# Đề xuất: Trang "Tình trạng hệ thống" + cảnh báo vận hành trong ai-admin

## Vì sao
- 28/10 Claude CLI trên server bị đăng xuất ⇒ toàn bộ AI (chat, trợ lý SHT, trợ lý giá) ngừng gần một ngày, chỉ biết khi người dùng hỏi.
- Hiện có: `uptime-check.ps1` chạy trên máy dev (chỉ xem HTTP < 400 của 3 host), `backup.sh` cron trên server (OFFSITE chưa đặt), `hub.provider_state` (agent-runtime ghi `ok|busy|cooldown|error|logged_out`), `/health` admin-api tĩnh (không ping DB), `/health` hub-api ping DB+Redis. Không có chỗ nào gom lại, không ai được báo.
- Pha Operations là điểm yếu nhất của dây chuyền (`docs/platform/dev-flow.md`).

## Thay đổi gì
1. **Vòng kiểm `ops-watch` trong hub-api** (`startLoop`, mặc định 30 phút, cờ `HUB_OPS_WATCH=on|off`): **code thường, 0 token AI**. Mỗi check là một module cắm qua registry nhỏ (giống registry node CR-103), trả `ok | warn | crit` + giá trị + thông điệp + gợi ý sửa.
2. **Các check v1:**
   | Check | Nguồn | warn | crit |
   |---|---|---|---|
   | Provider AI | `hub.provider_state` | `cooldown`/`busy` > 30 phút | `logged_out` hoặc `error`; mọi provider không `ok` |
   | Run AI thất bại | `hub.runs` 1 giờ qua (≥ 10 run) | > 20 % failed | `ALL_PROVIDERS_EXHAUSTED` > 0 trong 30 phút |
   | DB / Redis | ping như `/health` | — | lỗi |
   | Host công khai | GET 5 host (sohoptac, ai, ai-admin, ai-hub, community) | 1 lần lỗi | 2 lần liền lỗi |
   | Chứng chỉ TLS | ngày hết hạn của 5 host | < 14 ngày | < 3 ngày |
   | Backup | file trạng thái do `backup.sh` ghi | `OFFSITE_DIR` chưa đặt | bản mới nhất > 26 giờ hoặc lỗi |
   | Đĩa server | file trạng thái do cron host ghi (`df`) | > 80 % | > 90 % |
   | Hàng đợi / run kẹt | job orphaned, run quy trình `running` quá timeout | > 0 trong 1 giờ | > 5 |
3. **Lưu + lịch sử:** bảng `hub.ops_checks` (trạng thái mới nhất mỗi check) + `hub.ops_events` (chỉ lưu khi đổi trạng thái), không có `tenant_id`, chỉ vai hub + platform admin đọc.
4. **Cảnh báo:** khi một check **đổi** sang `warn`/`crit` hoặc hồi phục ⇒ `notify.enqueue` (source `ops`, `dedup_key` theo check+trạng thái) tới **mọi platform_admin đang hoạt động** ⇒ hiện ở chuông của ai-admin. Không lặp mỗi lượt kiểm.
5. **Trang `/system` "Tình trạng hệ thống"** trong admin-web (nhóm Hệ thống, chỉ platform_admin): thẻ màu theo trạng thái, lúc kiểm cuối, thông điệp + gợi ý sửa (vd lệnh đăng nhập lại Claude CLI), lịch sử 50 sự kiện, nút **"Kiểm tra ngay"**, nút **"Gói chẩn đoán"** (gom trạng thái + lỗi gần nhất + bản deploy thành văn bản để dán cho Claude Code — 0 token trong app).
6. **Phía server:** `backup.sh` ghi `ops-status/backup.json`; cron host 30 phút ghi `ops-status/host.json` (`df`, phiên bản deploy); compose gắn `./ops-status` (chỉ đọc) vào hub-api — không gắn thư mục backup.

## Không làm (v1)
- AI tự chẩn đoán trong app (khi sự cố là AI ngừng thì AI trong app cũng ngừng) — v2, dùng provider dự phòng.
- Tự sửa trên prod (restart, deploy, đăng nhập) — chỉ báo + gợi ý.
- Email/Telegram — chuông trong app trước; web push đã có khung (`HUB_NOTIFY_MODE`) để sau.

## Chia lát (Luật 0c)
| Lát | Model | Nội dung |
|---|---|---|
| O1 `ops-core` | **Opus medium** | migration hub 0064 (`ops_checks`, `ops_events`, grant/RLS), registry check, vòng + chuyển trạng thái idempotent (nhiều instance), `notify.enqueue` tới platform admin, `GET /ops/status`, `POST /ops/check`, int test |
| O2 `ops-checks` | Sonnet (sau O1) | 8 check theo bảng, đọc file trạng thái, TLS/HTTP với timeout, gợi ý sửa |
| O3 `ops-ui` | Sonnet (song song O2) | trang `/system`, nav, chuông, Gói chẩn đoán, e2e |
| O4 `ops-host` | Sonnet | `backup.sh` ghi trạng thái, script cron host, compose mount, README deploy |
| dò code, chạy lại test, dọn | Haiku | |

Chi phí vận hành: **0 token** (không gọi AI định kỳ). Chi phí xây: ~4 lát.

## Quyết định (người dùng chốt 2026-10-30)
1. Cảnh báo tới mọi platform_admin đang hoạt động.
2. Ngưỡng như bảng trên (hằng số, chỉnh sau).
3. v1 chỉ "Gói chẩn đoán"; AI trong app để v2.
4. **Tần suất 30 phút cho mọi check** (người dùng đổi từ 5 phút) — env `HUB_OPS_WATCH_EVERY_MS` mặc định 1 800 000; "Kiểm tra ngay" để kiểm tức thì. Ngưỡng "2 lần liền lỗi" của host công khai giữ nguyên (≈ 1 giờ).
5. Chỉ chuông ai-admin.
