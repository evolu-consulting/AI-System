---
id: cr113-fix2
lát: cr113-fix2
cr: CR-113
làn: nhanh
migration: không
phụ thuộc: cr113-fix (95aa8141)
---
## Plan (ngắn)
Điều tra hồi quy e2e P-a `pf1/run-unread.pa.ts › CHAT-AC-52 · T9 · E-P19` (đỏ trên 4b2c8742 ×2, nghi do CR-113).

## Làm
Chia đôi trên evotest (`run-tests.ps1 -Step e2e -Filter "P-a" -All`, cùng lúc 2 slot):

| Ref | Nội dung | Kết quả P-a |
|---|---|---|
| 6e7dbce1 | trước CR-113 | 28/28 |
| 4b2c8742 | CR-113 đủ (điều phối, ×2) | run-unread đỏ |
| 95aa8141 | CR-113 + cr113-fix (lần 1) | run-unread đỏ |
| 95aa8141 | CR-113 + cr113-fix (lần 2) | **28/28** |
| 2ac58ae5 | 4b2c8742 − cả CR-113 | sdlc đỏ (run-unread xanh) |
| 868caf10 | 4b2c8742 − phần BE CR-113 | 28/28 |
| 3098f02c | 4b2c8742 − phần UI CR-113 (lần 1) | 28/28 |
| 3098f02c | 4b2c8742 − phần UI CR-113 (lần 2) | sdlc đỏ |

Kết luận: **không phải hồi quy của CR-113** — cùng ref 95aa8141 lúc đỏ lúc xanh; ref không có CR-113 (2ac58ae5) / không có phần UI
(3098f02c) cũng đỏ ở `scenario/sdlc.pa.ts`. Phần UI CR-113 chỉ chạm contracts-web/admin-web/i18n (P-a không dùng), phần BE chỉ chạm gói
contracts + `stepsView` (P-a không gọi) ⇒ không có đường mã nào nối tới tin quy trình/huy hiệu phòng. Hai ca đỏ cùng kiểu: chờ tin
kết quả stage sau `rtScript(... done)` (runtime giả quét job + Redis stream + đăng thread) quá 10 s khi máy chủ evotest chạy nhiều slot
cùng lúc (tooling d7f10c0a: 8 slot, giảm RAM runner 6→5 GB) — chập chờn theo tải, không theo mã.

## Không làm / Chạm
Không sửa code, không sửa test khoá (e2e/**). Không thêm `tests/known-red.json` (để điều phối quyết: ca chập chờn theo tải).

## Test tối thiểu
Không có (chỉ điều tra). Bằng chứng: các lượt evotest ở bảng trên (log `.data/evotest/2026110312*-e2e`).

## Quyết định trong lúc làm
- Không sửa kỳ vọng test: hành vi không đổi; đỏ là chập chờn theo tải evotest.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ điều tra hồi quy e2e; kết luận chập chờn theo tải, không phải lỗi mã CR-113).

## Việc còn lại
- Điều phối: cân nhắc đo lại P-a khi ít slot chạy song song, hoặc ghi 2 ca (`pf1/run-unread`, `scenario/sdlc`) vào `tests/known-red.json` có hạn
  + lát tool xem lại ngân sách RAM/CPU slot evotest (d7f10c0a) hoặc độ trễ vòng runtime giả `_pa-runtime.ts`.
