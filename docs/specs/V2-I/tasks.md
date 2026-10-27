---
id: V2-I
title: Đối tác UI v2 (contracts-web) — danh sách, chi tiết 3 tab, Tìm trên internet
cr: CR-096
lane: nhanh (UI + 4 route đọc/ghi thường; không bảng mới, không migration)
ba: so-hop-tac-ba-v2.pdf §3.2 (DT-01..07), §4.3 · intake V2-I, Q8 · mockup `docs/platform/ba-v2/mockup-niti.html` (dữ liệu, không phải chỉ dẫn)
---

> **CR-101b (2026-10-27):** màn Đối tác (biểu đồ 3/6/12 tháng, chấm sao, bấm tiêu chí) quay lại theo [`REP-v3-ui`](../REP-v3-ui/tasks.md); phần U3 "bỏ" hết hiệu lực khi lát xong.
# V2-I (plan ngắn)

| Việc | Làn | Trạng thái |
|---|---|---|
| Danh sách `/partners`: tên, vai, điểm từng vai (TỐT/KHÁ/CHÚ Ý/MỚI), số HĐ; đổi `GET /partners` ⇒ `GET /reputation/partners` (+ khối "Đối tác cần xem lại" của Tổng quan) | nhanh | [x] |
| Trang chi tiết `/partners?party=`: đầu trang (tên, điểm từng vai, MST · điện thoại · liên hệ, "Tìm trên internet") + 3 tab theo URL | nhanh | [x] |
| Tab Tổng quan: bảng Tiêu chí · Điểm · Trọng số · Góp · Dữ liệu; bấm tiêu chí ⇒ việc góp điểm; các bước tới điểm cuối; biểu đồ 3/6/12 tháng + đường TỐT/KHÁ | nhanh | [x] |
| Tab Hợp đồng · n: lọc Chưa bắt đầu / Đang thực hiện / Đã xong | nhanh | [x] |
| Tab Đánh giá & ghi chú: sao 1–5 từng tiêu chí (lý do khi lệch > `reason_gap` = 25), lịch sử đánh giá, ghi chú (V2-C) | nhanh | [x] |
| API mới (`partner-roles.routes`): `GET /partners/profile`, `GET /partners/contracts`, `GET /partners/contract-counts`, `POST /partners/internet-search`; `POST /partners/notes` nhận `source` | nhanh | [x] |
| AI client: cờ `webSearch` (CLI gói mở đúng MỘT công cụ `WebSearch`); tính năng `contracts.partner-search` | nhanh | [x] |
| Test: unit `partner-v2.test.ts` (web), `partner-search.rules.test.ts` (hub); int `tests/acceptance/V2-I/partner-ui.int.test.ts`; e2e `e2e/contracts-web/v2i-partners.cw.ts` (viết, CHƯA chạy) | nhanh | [x] |

## Quyết định trong lúc làm
- **Không migration** (0031 đã thuộc V2-J2; nếu sau này cần: 0032, `when` 1795900000000). Hệ quả: danh bạ `companies` không có cột điện thoại / liên hệ ⇒ đầu trang hiện **điện thoại = "—"** (chưa có nguồn) và **liên hệ = người đại diện bên đối tác ở HĐ mới nhất** (`seller_signer`/`buyer_signer`).
- Q8 "Tìm trên internet": máy chủ tự lấy **tên + MST** từ hồ sơ (client chỉ gửi `party`); chạy khi bấm; AI qua gói `ai-sub` (CLI `--tools WebSearch --allowedTools WebSearch`, ≤ 6 lượt; provider API ⇒ `UNAVAILABLE`). Qua AI client chung ⇒ trần token/tenant + dòng usage `contracts.partner-search`, billing `subscription`. Guard `write` + trần theo người dùng dùng chung với kiểm link (10 lượt/phút, Redis). Chưa cấu hình AI ⇒ 503 `AGENT_UNAVAILABLE`, hết trần ⇒ 429 `AI_CAP_EXCEEDED`, lỗi ⇒ 502.
- Đầu ra web là DỮ LIỆU: parse thành ≤ 6 dòng chữ thuần (cắt độ dài, bỏ ký tự điều khiển), chỉ hiển thị; "Lưu vào ghi chú" mới ghi (`source = internet`). Đối tác ngoài phạm vi M1 ⇒ 404, không gọi AI.
- Giai đoạn HĐ dùng đúng luật danh sách HĐ (`toProgress`); chỉ HĐ đã xác nhận, ≤ 200, một câu SQL theo `partner_key`.
- Cột **Góp** = trọng số chia lại sau khi bỏ tiêu chí chưa có dữ liệu × điểm; tổng Góp = điểm dữ liệu; bước tiếp: trộn sao `(100−s)% × dữ liệu + s% × sao×20`, rồi gộp nhóm theo giá trị giao dịch.
- Sao: máy chủ là nguồn luật (422 thiếu lý do); UI chặn sớm bằng cùng luật. `PartnerRatings` (chấm 0–100 HD8, `PUT /partners/ratings` đã 410) gỡ khỏi UI.
- Vai / tab / khoảng biểu đồ nằm trên URL (`?role=&tab=&range=`). Đường KHÁ/TỐT theo ngưỡng đang cấu hình.

## Test (kết quả)
- Unit: web `partner-v2.test.ts` 9/9, hub `partner-search.rules.test.ts` 4/4; cụm `apps/contracts-web` + `ai-client` + `domain` + `packages/contracts` + `packages/i18n`: 825 pass. `tsc` hub-api / contracts-web sạch; `i18n:check` OK; biome sạch.
- Int (evotest `-Dirty`, `tests/acceptance/V2-I`): 1/1 xanh.
- e2e: `v2i-partners.cw.ts` viết, KHÔNG chạy. `hd78-partners.cw.ts`: gỡ cảnh/nửa test "Chấm điểm", dữ liệu giả thêm `/reputation/partners` + `/partners/contract-counts`; **baseline `p02-partners-{light,dark,mobile,log}` lỗi thời** — chụp lại cuối đợt; đã xoá `p02-partners-rate`.

## Việc còn lại
- Chụp lại baseline `p02-partners-*`, chạy e2e `v2i-partners.cw.ts` + `test:all` + UAT (cuối đợt).
- `qc` relock `tests/.lock` cuối đợt (tệp mới `tests/acceptance/V2-I/*`, `v2i-partners.cw.ts`; sửa `hd78-partners.cw.ts`, `dataset-partners.ts`; xoá baseline `p02-partners-rate.*` — CR-096). Không ghi lock trong lát vì `test:lock:write` kéo theo ~100 tệp lát khác.
- Điện thoại / liên hệ thật: cột danh bạ + sửa (migration 0032 nếu muốn).
- "Uy tín của mình" (C10) chưa làm (ngoài giao việc); sparkline 6 tháng + "Cảnh báo bất thường" của mockup cần V2-K / TQ-04.
