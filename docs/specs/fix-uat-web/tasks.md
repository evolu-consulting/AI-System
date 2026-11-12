---
id: fix-uat-web
lát: fix-uat-web (soát ảnh UAT — 9 lỗi giao diện/luật vùng web + 2 chỗ hub nhỏ)
cr: CR-130, CR-132
làn: nhanh
migration: không
phụ thuộc: fix-e2e-web
---
## Plan (ngắn)
| # | Ảnh | Sửa |
|---|---|---|
| 1 | 02, 18 | i18n `work.*`: «Rút về DRAFT» ⇒ «Rút về Nháp» (cùng nhãn trạng thái «Nháp» đã có); vi + en (`Draft`), gồm câu giải thích, toast, tiêu đề hộp và mô tả quy trình `process/admin` |
| 2 | 06, 08 | ảnh trong tin hiện thu nhỏ. Nguyên nhân: tải tệp bằng `fetch` theo 302 sang FileBox (khác origin, dev chứng chỉ tự ký) ⇒ lỗi ⇒ rơi về thẻ tệp. Sửa: hub thêm `GET …/messages/conversations/:id/files/:fileId/link` ⇒ `{url}` (JSON, cùng kiểu `contract-files /link`); web xin link bằng Bearer rồi dùng thẳng `<img src>`/tab mới (không CORS, không object URL), ô chỉ xin link khi hiện ra (IntersectionObserver), lỗi ảnh ⇒ thẻ tệp |
| 3 | 06, 08 | nút nổi trợ lý ẩn ở `/contracts/messages` (`fabHiddenOn`) — che nút Gửi |
| 4 | 07 | «Hủy» ⇒ «Huỷ»: hộp Nhắn tin mới dùng khoá chung `contracts.common.cancel` (bỏ khoá riêng `messages.cancel`) |
| 5 | 17, 18 | thanh dưới: nhãn ngắn `shortLabelKey` («Hợp đồng»), mục «Tin nhắn» vào thanh dưới (5 cột vừa); ô «Phụ trách» chừa gutter 16 px + `max-w-full` ở ≤ sm |
| 6 | 08b | thẻ «Sản phẩm: nên làm gì»: cột `min-w-0`, nhãn cột cắt bằng dấu … (không tràn mép phải) |
| 7 | 16 | `/community` khi Bảng tin chưa bật: guard không còn đẩy nhân viên nội bộ về Tổng quan (`bouncesHome`); trang hiện `EmptyState kind="off"` «Bảng tin chưa được bật cho công ty — liên hệ quản trị nền tảng» (đối tác không có SHT vẫn về home) |
| 8 | 12 | user ngoài: `packsFor` luôn `contracts=false` (kể cả mặc định trước `/pack/me`), `/pack/nav` không gọi, nguồn cờ không mở `/me/stream` (`setStreamGate`). Kiểm bằng log mạng với `doitac-tanphat`: hết 403 |
| 9 | 11 | chuông Bảng tin (hub `notify.rules.ts`): «{Tên} bình luận bài: “trích 60 ký tự”» / «{Tên} bình luận một bài đăng» (bài không tiêu đề), `body` rỗng (không lặp tên); áp cho mọi loại (trả lời, nhắc tên, bài mới, khớp, sửa giá, hết hạn) |

## Quyết định trong lúc làm
- Mục 2 và 9 chạm hub (file ngoài vùng web) vì nguyên nhân ở đó; đổi nhỏ, có unit. Hub đang chạy chưa nạp mã mới ⇒ ảnh chụp 06/08 dùng giả lập `/link` (lấy Location thật của route 302) và ảnh 11 vẫn là câu cũ cho tới khi hub khởi động lại.
- Mục 4: các «Hủy» còn lại thuộc i18n Community riêng (`community/vi.json`), ngoài vùng ảnh.
- Mục 5: «Tin nhắn» bỏ `mobile: "more"` ở W3 nên đã có trên thanh dưới; thêm nhãn ngắn để «Hợp đồng & giao dịch» không bị cắt.
- Mục 8: user ngoài vẫn nghe `config.changed` bằng tải lại khi lấy lại tiêu điểm (không push).

## Test
unit: `shell-lib.test.ts` (fabHiddenOn, nhãn ngắn), `auth/lib/guard.test.ts` » bouncesHome, `shell/packs-for.test.ts`, hub `notify.rules.test.ts` (chữ chuông gọn, trích Unicode). Đã chạy: workspace-web 877 xanh + 1 đỏ có sẵn (`attach.test.ts`), hub rules 29 xanh; tsc workspace-web sạch; biome; `i18n:check`; `build` + `check:bundle` OK (js 145.1 KB). Ảnh chụp lại: `…\uat-shots\out2\` (02, 06, 08, 08b, 11, 16, 17, 18).

## Việc còn lại
Khởi động lại hub để chuông dùng câu mới và `/link` thật; qc cập nhật e2e nếu có chỗ chờ chữ «DRAFT» / «Hủy» / nút nổi ở Tin nhắn.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
### ADDED shell/sua-loi-uat-web.md
#### Yêu cầu: Giao diện nói tiếng nghiệp vụ và không che nút (nguồn: CR-130, CR-132)
Màn hợp đồng gọi trạng thái đầu là «Nháp» (không hiện mã DRAFT); ảnh trong tin nhắn hiện thu nhỏ và bấm mở lớn; nút nổi trợ lý không che ô soạn tin; thanh dưới điện thoại có nhãn vừa cột; Bảng tin chưa bật thì nói rõ vì sao thay vì tự chuyển trang; đối tác không bị gọi các API của Sổ Hợp Tác; chuông bình luận Bảng tin gọn một câu.
- Kịch bản: khi mở `/contracts/messages` thì nút nổi trợ lý bị ẩn, trang khác thì hiện [test: apps/workspace-web/src/features/shell/lib/shell-lib.test.ts » fabHiddenOn]
- Kịch bản: khi nhân viên nội bộ vào `/community` lúc Bảng tin chưa bật thì không bị chuyển về Tổng quan; đối tác vào trang không có quyền thì về trang chủ [test: apps/workspace-web/src/features/auth/lib/guard.test.ts » bouncesHome]
- Kịch bản: khi người xem là đối tác thì gói Sổ Hợp Tác luôn tắt ở khung ứng dụng [test: apps/workspace-web/src/shell/packs-for.test.ts » packsFor]
- Kịch bản: khi có bình luận trên bài không tiêu đề thì chuông viết «{Tên} bình luận một bài đăng», có tiêu đề thì trích tối đa 60 ký tự và không lặp tên [test: apps/hub-api/src/modules/packs/community/domain/notify.rules.test.ts » chữ chuông gọn]
