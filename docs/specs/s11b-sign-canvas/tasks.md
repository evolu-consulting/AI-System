---
id: s11b-sign-canvas
lát: s11b-sign-canvas
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s11a
---
## Plan (ngắn)
Khung màn ký toàn màn hình «Từng trang» (đợt 1), chưa gọi API: props vào, callback ra. Dùng lại `lib/` hình học của s11a.

## Làm
- [x] `components/SignWorkspace.tsx` (khung), `PageStage` (pdf.js, dpr ≤ 2), `PageRail`, `FileTabs`, `MarkBox`, `FieldBox`, `BoxFrame` (kéo/đổi cỡ/bàn phím), `FloatBar`, `StageMenu` (chuột phải, chạm giữ 550ms), `StageItems`, `SignTopBar` (Ký bằng + khay), `LeaveDialog`
- [x] `hooks/use-sign-items.ts` + `lib/sign-items.ts` (thêm/sửa/xoá/chép sang mọi trang, parts bằng `partsOf` mỗi lần thả), `hooks/use-pdf-doc.ts`, `lib/layout.ts`, `lib/keys.ts`
- [x] i18n `contracts.docsign.*` (VI + EN) ở `packages/i18n/locales/contracts/docsign.*.json`, nạp qua `contracts-locales.ts`
- [x] Test `components/sign-workspace.test.tsx`

## Không làm / Chạm
Không gọi API, không nối dữ liệu thật / tự đặt chỗ ký (s12), không xem bản đã ký (s14), không nút chọn kiểu xem. Chạm `packages/i18n/src/contracts-locales.ts` (thêm một phần `docsign`, đặt TRƯỚC `esign-anchor` để giữ vị trí tính từ cuối).

## Test tối thiểu
`bun test apps/workspace-web/src/features/doc-sign` — 24 ca xanh; `tsc --noEmit` workspace-web sạch; `check:ui-kit`, `i18n:check` xanh.

## Quyết định trong lúc làm
- Môi trường test không có DOM ⇒ logic thao tác (đặt/kéo/xoá/phím/đóng) tách thành hàm thuần (`sign-items.ts`, `keys.ts`) test trực tiếp; phần hiển thị test bằng `renderToStaticMarkup`. Kéo chuột/pdf.js thật để e2e lát sau.
- Nguồn sự thật của một mục = `parts` (điểm PDF); px chỉ suy ra khi vẽ ⇒ đổi cỡ cửa sổ không lệch.
- «Chép sang mọi trang» chỉ hiện cho chữ ký tự do (mark) ở chế độ ký; «Đổi người» chỉ ở chế độ chuẩn bị, xoay vòng qua các khay «Chỗ ký».
- Chữ ký số khoá: mục vẫn focus được, lý do hiện bằng Tooltip và có chữ ẩn `sr-only` cho đọc màn hình/chạm.
- Thêm prop `kind` + `onKindChange` và `onFieldClick` ngoài danh sách đề bài (cần để ToggleGroup điều khiển được và nút «Bấm để ký» có đường ra).
- Màu bên A/B dùng lớp palette Tailwind `violet`/`orange` (không hex) — nếu có token chuyên dụng thì đổi ở lát sau.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Màn ký toàn màn hình, đặt chữ ký trên tài liệu
Người ký kéo chữ ký (hoặc ô chỗ ký) từ khay vào trang PDF, kéo/đổi cỡ/xoá, chép sang mọi trang; chữ ký đặt qua khe hai trang thành giáp lai (tối đa 5 trang).
- Kịch bản: khi thả chữ ký từ khay vào một trang thì mục mới có đúng một phần ở trang đó [test: apps/workspace-web/src/features/doc-sign/components/sign-workspace.test.tsx » thả từ khay vào một trang ⇒ item có 1 phần ở trang đó]
- Kịch bản: khi kéo chữ ký qua khe giữa hai trang thì mục có 2 phần [test: apps/workspace-web/src/features/doc-sign/components/sign-workspace.test.tsx » kéo qua khe giữa hai trang ⇒ 2 phần, kéo lại vào một trang ⇒ 1 phần]
- Kịch bản: khi bấm Delete trên chữ ký sửa được thì mục bị xoá, mục của người khác giữ nguyên [test: apps/workspace-web/src/features/doc-sign/components/sign-workspace.test.tsx » Delete ⇒ hành động xoá, xoá bỏ item sửa được và giữ item của người khác]

#### Yêu cầu: Bấm ô để ký
Ở chế độ ký, ô của mình hiện nút «Bấm để ký»; ô của người khác chỉ hiện «Chờ <người> ký» và không bấm được.
- Kịch bản: khi ô thuộc người khác thì hiện «Chờ Bình ký» và không có nút [test: apps/workspace-web/src/features/doc-sign/components/sign-workspace.test.tsx » ô người khác: «Chờ Bình ký», không có nút bấm]
- Kịch bản: khi ô thuộc mình thì có nút «Bấm để ký» [test: apps/workspace-web/src/features/doc-sign/components/sign-workspace.test.tsx » ô của mình: nút «Bấm để ký»]

#### Yêu cầu: Chọn loại chữ ký, chữ ký số khoá kèm lý do
«Ký bằng: Chữ ký nội bộ | Chữ ký số»; mục số khoá và hiện lý do khi công ty chưa bật hoặc người dùng chưa có chứng thư.
- Kịch bản: khi chữ ký số bị khoá thì mục có aria-disabled và kèm lý do [test: apps/workspace-web/src/features/doc-sign/components/sign-workspace.test.tsx » «Chữ ký số» khoá kèm lý do]

#### Yêu cầu: Rời màn ký khi còn chữ ký chưa lưu
- Kịch bản: khi còn chữ ký chưa lưu và đóng màn thì hỏi «Rời màn ký?» trước, sạch thì đóng luôn [test: apps/workspace-web/src/features/doc-sign/components/sign-workspace.test.tsx » dirty ⇒ hỏi khi đóng, sạch ⇒ đóng luôn]

## Việc còn lại
- Chưa kiểm bằng trình duyệt thật: kéo chuột, thả từ khay, chạm giữ 550ms, render pdf.js, cuộn tới trang (cần e2e/lát nối dữ liệu s12).
- Chưa dùng ở route nào (chỉ component).
