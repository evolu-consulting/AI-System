# X2a — kiểm I2 bằng trình duyệt tự động (2026-10-08)

Chạy theo yêu cầu người dùng: điều phối viên lái 2 trình duyệt Chromium độc lập (Playwright/CDP) trên stack dev thật —
`bun run hub:dev` (Hub :4000, admin-api :3001, Postgres/Redis docker) + chat-web `rsbuild dev` :3100 trỏ Hub thật.
Tenant `evolu`: **A = julian.bui** (tenant_admin), **B = thomas.tran**. Script: [`scripts/run.mjs`](scripts/run.mjs),
[`scripts/outage.mjs`](scripts/outage.mjs). Kết quả máy đọc: [`result.json`](result.json).

**Kết quả: 14/14 bước đạt.**

| # | Bước | Kết quả | Ảnh |
|---|---|---|---|
| 01 | Hai user đăng nhập; sidebar có "Evolu team" | Đạt | `01-A-*`, `01-B-*` |
| 02 | A tìm "Thomas" → mở DM → gửi; B thấy huy hiệu chưa đọc + tổng, không reload | Đạt | `02-*` |
| 03 | B mở DM thấy tin; A thấy "Đã xem" | Đạt | `03-*` |
| 04 | B trả lời → A nhận realtime | Đạt | `04-*` |
| 05 | A nhắn "Evolu team" → B thấy huy hiệu; tin trong nhóm có tên người gửi | Đạt | `05-*` |
| 06 | A tạo nhóm (Thomas + Vio) → B thấy nhóm mới | Đạt | `06-*` |
| 07 | A (chủ) thêm Rowan; danh sách thành viên | Đạt | `07-*` |
| 08 | B (thành viên) không có Đổi tên/Xoá; A đổi tên → B thấy tên mới | Đạt | `08-*` |
| 09 | A ẩn DM → B nhắn → DM hiện lại ở A | Đạt | `09-*` |
| 10 | B "offline" (giả lập Playwright) → A gửi → B nhận | Đạt* | `10-*` |
| 11 | B mở DM với Vio qua tìm người | Đạt | `11-*` |
| 12 | A xoá nhóm khi B đang mở → B về `/c/new` + toast | Đạt | `12-*` (toast đang mờ dần, góc phải dưới) |
| 13 | Giao diện điện thoại 390px | Đạt | `13-*` |
| 14 | **Đứt kết nối thật**: chặn `/me/stream` của B + khởi động lại Hub → banner "Không kết nối được máy chủ"; A gửi lúc B đứt; mở chặn → B nối lại (`Last-Event-ID`) và nhận bù tin, banner tắt | Đạt | `14-*` |

\* Bước 10: giả lập offline của Chromium không cắt kết nối SSE đang mở, nên tin vẫn tới qua kết nối cũ và không hiện
banner — bước này không chứng minh được việc nối lại. Bước 14 kiểm đúng đường nối lại + nhận bù.

## Lỗi tìm thấy
- **Seed demo evolu không tạo được user** (`POST /admin/users` → 400 `EMAIL_REQUIRED`: role `tenant_admin` bắt buộc
  email). Đã sửa `tools/hub-dev/src/fixture.ts`: user demo có email `<username>@evolu.local`. Sau sửa, `hub:dev` tạo đủ
  5 user + "Evolu team" + DM Julian–Thomas.
- Không thấy lỗi sản phẩm nào khác trong 14 bước.
