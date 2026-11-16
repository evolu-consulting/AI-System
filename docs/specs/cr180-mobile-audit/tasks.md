---
id: cr180-mobile-audit
lát: cr180-mobile-audit
cr: CR-180
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lát 3/3 của CR-180: e2e «kiểm mobile» chặn tái phát. Mỗi màn chính ở 390×844 (isMobile, hasTouch) kiểm 4 luật:
R1 không tràn ngang · R2 vùng bấm ≥ 44 px mỗi cạnh · R3 chữ ≥ 12 px · R4 nút trợ lý nổi không che nút bấm lúc trang vừa mở.
Lỗi liệt kê từng phần tử (testid/aria-label/chữ + kích thước). Test ĐỎ trên code hiện tại là đúng ý (lát kit/shell và lát trang sửa sau).

## Làm
- [x] `e2e/_kit/mobile-rules.ts`: hàm đo `measureMobile`/`expectMobileRules`, bảng ngoại lệ `MOBILE_EXEMPTIONS`.
- [x] `e2e/contracts-web/mobile-rules.cw.ts`: 12 màn (Tổng quan, Danh sách HĐ, Chi tiết HĐ, Tạo HĐ, Việc của tôi, Đối tác, Chi tiết đối tác, Sản phẩm, Sơ đồ tổ chức, Tin nhắn, Khung chat, Cài đặt thành viên, Thông báo).
- [x] `e2e/community-web/mobile-rules.cm.ts`: Bảng tin, Hồ sơ (/community/me), Yêu cầu tham gia, Báo cáo vi phạm.
- [x] Ảnh mẫu 390 px: sẵn `s03-list-mobile` (Danh sách HĐ), `v2f-detail-mobile` (Chi tiết HĐ), `p02-partners-mobile` (Đối tác); thêm `messages-mobile` (`scenes.cw.ts`) và `bang-tin-mobile` (`community-web/scenes-mobile.cm.ts`, config community thêm `CM_MODE=capture`). CHƯA chụp baseline: điều phối chụp sau lát 2.
- [x] Tách `installHub` khỏi `scenes.cw.ts` sang `e2e/contracts-web/_hub.ts` (dùng lại; hành vi giữ nguyên).

## Không làm / Chạm
Không sửa code sản phẩm, không chạy Playwright local, không chụp baseline, không thêm known-red.

## Cách chạy
- evotest: `$env:EVOTEST_KEY="$HOME\.ssh\evoc_key"; powershell -File deploy/evotest/run-tests.ps1 -Step e2e -Filter "contracts-web,community-web" -Wave` (thêm `-Dirty` nếu chưa commit).
- Mỗi ca in một dòng `[mobile-rules] <màn>: R1=n R2=n R3=n R4=n`; mỗi luật một `expect.soft` nên ca đỏ liệt kê đủ phần tử.
- Chụp baseline ảnh (điều phối, sau lát 2): contracts `-Capture cw` (Linux); community `CM_MODE=capture` cùng config `e2e/community-web/playwright.config.ts`.

## Ngoại lệ đã khai (`MOBILE_EXEMPTIONS`)
- `badgeMinText`: chấm badge số (chữ chỉ gồm 1–3 chữ số, có thể có «+») chỉ cần ≥ 11 px.
- `inlineLinkInText`: link chữ nằm giữa câu (cha p/li/span/div/td có chữ khác) không tính vùng bấm.
- `hScrollAncestor`: phần tử vượt phải bên trong `table`, `[role=tablist]`, `[data-hscroll]` hoặc tổ tiên `overflow-x` auto/scroll/hidden/clip không tính tràn ngang.
- `hiddenInput`: ô tick/radio ẩn thị giác nằm trong `<label>` thì đo theo nhãn.
- `invisible`: phần tử ẩn (display none, visibility hidden, opacity 0, aria-hidden, < 1 px) và phần tử nằm hẳn ngoài khung ngang (trong vùng cuộn) không tính vùng bấm.

## Test tối thiểu
Chính là các spec trên (đỏ khi còn vi phạm).

## Quyết định trong lúc làm
- Lượt evotest 1 (c43da3194): contracts-web vỡ «Something went wrong» do fallback API chung ⇒ bỏ. Lượt 2: 13 màn đo được, vi phạm theo màn trong báo cáo; «Chi tiết đối tác» sửa selector mở dòng, chưa chạy lại.
- Dữ liệu contracts-web: giả bằng `installHub`; API chưa giả trả `{items:[],total:0}` ⇒ màn Tin nhắn/Sơ đồ/Thông báo/Cài đặt đo trạng thái rỗng (không phải dữ liệu thật như bản kiểm tay).
- R4 đo ngay sau khi trang yên, trước mọi thao tác; màn Chi tiết đối tác đo thêm lần hai sau khi mở dòng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/mobile-kiem-tu-dong.md
#### Yêu cầu: Các màn chính đạt 4 luật mobile ở 390 px
Mỗi màn chính của Sổ Hợp Tác và Cộng đồng, ở 390×844, không tràn ngang, mọi nút/link/ô nhập bấm được có cạnh ≥ 44 px, chữ ≥ 12 px (badge số ≥ 11 px), và nút trợ lý nổi không che phần tử bấm được lúc trang vừa mở. Ngoại lệ chỉ nằm ở bảng có tên trong `e2e/_kit/mobile-rules.ts`.
- Kịch bản: khi mở Tổng quan ở 390 px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Tổng quan]
- Kịch bản: khi mở Danh sách HĐ ở 390 px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Danh sách HĐ]
- Kịch bản: khi mở Chi tiết HĐ ở 390 px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Chi tiết HĐ]
- Kịch bản: khi mở Tạo HĐ ở 390 px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Tạo HĐ]
- Kịch bản: khi mở Việc của tôi ở 390 px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Việc của tôi]
- Kịch bản: khi mở Đối tác ở 390 px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Đối tác]
- Kịch bản: khi mở dòng đối tác ở 390 px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Chi tiết đối tác]
- Kịch bản: khi mở Sản phẩm ở 390 px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Sản phẩm]
- Kịch bản: khi mở Sơ đồ tổ chức ở 390 px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Sơ đồ tổ chức]
- Kịch bản: khi mở Tin nhắn ở 390 px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Tin nhắn]
- Kịch bản: khi mở Khung chat ở 390 px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Khung chat]
- Kịch bản: khi mở Cài đặt thành viên ở 390 px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Cài đặt thành viên]
- Kịch bản: khi mở Thông báo ở 390 px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Thông báo]
- Kịch bản: khi mở Bảng tin ở 390 px thì 4 luật đạt [test: e2e/community-web/mobile-rules.cm.ts » Bảng tin]
- Kịch bản: khi mở Hồ sơ ở 390 px thì 4 luật đạt [test: e2e/community-web/mobile-rules.cm.ts » Hồ sơ]
- Kịch bản: khi mở Yêu cầu tham gia ở 390 px thì 4 luật đạt [test: e2e/community-web/mobile-rules.cm.ts » Yêu cầu tham gia]
- Kịch bản: khi mở Báo cáo vi phạm ở 390 px thì 4 luật đạt [test: e2e/community-web/mobile-rules.cm.ts » Báo cáo vi phạm]
- Kịch bản: Bảng tin ở 390 px khớp ảnh mẫu [test: e2e/community-web/scenes-mobile.cm.ts » bang-tin-mobile]
- Kịch bản: Tin nhắn ở 390 px khớp ảnh mẫu [test: e2e/contracts-web/scenes.cw.ts » messages-mobile]

## Việc còn lại
- Điều phối: chụp baseline `messages-mobile` + `bang-tin-mobile` (và chụp lại 3 cảnh mobile sẵn có) sau lát 2.
