---
id: v2-gaps
title: Ba khoảng trống sau V2-I / sso-switch — liên hệ đối tác, "Uy tín của mình", switcher ngược
lane: nhanh (migration chỉ cộng 2 cột; không bảng mới)
---
# v2-gaps (plan ngắn)

| Việc | Trạng thái |
|---|---|
| Migration 0037 (`when` 1796400000000, idx 35): `companies.phone`, `companies.contact_person` + CHECK độ dài; RLS FORCE sẵn từ 0015/0019 | [x] |
| `GET /partners/profile` đọc cột mới, liên hệ rơi về người đại diện HĐ mới nhất; `PUT /partners/profile` (upsert danh bạ, đối tác ngoài phạm vi 404) | [x] |
| UI: "Sửa" ở đầu trang chi tiết đối tác (`ContactEditor`); seed demo v2 thêm điện thoại/liên hệ theo mockup `PINFO` | [x] |
| C10 "Uy tín của mình": `GET /reputation/mine?days=` (mốc `owner='ours'` đã xong, trễ = `done_at > due_date`, lỗi do ai, đối tác bị ghi lỗi) + dải `MineBanner` trên `/partners` (chỗ mockup đặt) | [x] |
| contracts-web: nút "Ứng dụng" ở Header (AI System, Quản trị cho quản trị viên) ⇒ `/sso?app=chat\|admin` của chính nó ⇒ `<đích>/sso#code`; chat-web `/sso` nhận `#code` (admin-web đã có) | [x] |
| Test: unit `rep-mine.rules.test.ts`, `apps.test.ts`; int `tests/acceptance/V2-I/partner-contact.int.test.ts` (2 ca, gồm chéo tenant) — evotest xanh; e2e `02-contracts-pages.deployed.ts` +3 ca (viết, CHƯA chạy) | [x] |

## Quyết định
- Chỉ ghi liên hệ qua danh bạ; không đụng `partner_roles`. Không gọi lại `packs.secure_table` trong 0037 (nó cấp lại DELETE đã thu hồi ở 0019) — chỉ `FORCE ROW LEVEL SECURITY`.
- C10 theo mockup (dải trong trang Đối tác, 90 ngày) + intake C10 ("lỗi của mình chỉ ghi vào uy tín của mình, không trừ điểm đối tác"). BA PDF không đọc được bằng công cụ trong phiên (thiếu pdftoppm); bám intake + mockup.
- Switcher: URL từ build (`PUBLIC_CHAT_WEB_URL` hoặc `PUBLIC_SSO_URL`; `PUBLIC_ADMIN_WEB_URL`) — Dockerfile sohoptac2 đã truyền cả ba cho mọi web ⇒ không đổi deploy.

## Việc còn lại
- Chạy e2e deployed + relock `tests/.lock` (tệp int mới) cuối đợt; áp migration 0037 lúc deploy.