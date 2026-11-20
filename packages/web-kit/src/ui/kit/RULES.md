# Luật dùng bộ component chung (CR-177)

Máy chặn: `bun run check:ui-kit` (số `<button>`/`<select>`/`<input>` trần, `title=`, `components/ui` riêng, `text-[13px]`/`rounded-[9px]` chỉ được giảm).

## Xác nhận — 4 mức
- Đổi lại được ⇒ làm ngay + `toastUndo` 6 s. Đúng: xoá ghi chú rồi «Hoàn tác». Sai: hỏi «Bạn chắc chứ?».
- Cần nhập thêm ⇒ `InlineConfirm` ngay tại chỗ. Đúng: từ chối + ô «Lý do». Sai: mở dialog chỉ để có một ô nhập.
- Người khác thấy / khó rút lại ⇒ `Dialog` ngắn, nút ghi đúng hành động. Đúng: «Gửi duyệt». Sai: «OK»/«Có».
- Mất dữ liệu ⇒ `AlertDialog` danger, focus mặc định ở «Giữ lại». Đúng: «Xoá hợp đồng» / «Giữ lại». Sai: focus ở nút xoá.

## Nút
- Ba dạng: chỉ icon · icon + chữ · chỉ chữ. Không dạng khác.
- Icon một mình bắt buộc `aria-label` + `Tooltip`. Đúng: `<Button size="icon" aria-label="Đóng"><X/></Button>` trong Tooltip. Sai: `<button title="Đóng">✕</button>`.
- Icon lấy từ `icons.ts` theo khái niệm. Đúng: `ICONS.remove`. Sai: import `Trash`/`Trash2`/`X` tuỳ chỗ, hoặc emoji 🗑.
- Một nút chính (`primary`) mỗi màn. Đúng: «Gửi duyệt» primary, còn lại outline/quiet. Sai: hai nút primary cạnh nhau.
- Hàng nút cùng cỡ, cùng có hoặc cùng không icon. Sai: «Lưu» có icon, «Huỷ» không.
- Không có quyền ⇒ khoá + lý do: `<Button disabledReason="Chỉ Giám đốc duyệt được">`. Vai không bao giờ có ⇒ ẩn hẳn.
- Dùng `Button`/`Select`/`Input` của kit. Sai: `<button className="…">` trần.
- Tooltip bằng `Tooltip` của kit. Sai: `title="…"` trên thẻ HTML.

## Avatar
- Người ⇒ tròn; công ty ⇒ vuông bo. Cỡ chỉ 24/32/40.
- Mọi avatar NGƯỜI dùng `PersonAvatar` (CR-185); tooltip (rê/focus/chạm) CHỈ là họ tên. Đúng: `<PersonAvatar name={n} src={a} ring="ring-act" badge={dấuĐãKý} />`; trạng thái («Bên A», «Đã ký») = viền / dấu / chữ cạnh avatar. Sai: tooltip «Phụ trách: An», tự ghép `Avatar` + `Tooltip`. Avatar nằm trong nút/mục menu đã có tên bên cạnh ⇒ `interactive={false}`. Tooltip chạm cho phần tử khác: `TouchTip`.
- Nhóm tối đa 5 + «+N»; bấm nhóm ⇒ danh sách thả xuống (avatar, họ tên, chức vụ; cuộn khi > 8). Đúng: `<PersonAvatarGroup people={[{ name, id, src, jobTitle }]} />` (người), `<AvatarGroup>` (công ty). Sai: tự xếp avatar chồng nhau, tự làm danh sách.

## Badge
- 1–2 badge mỗi dòng; luôn có icon + chữ (không chỉ màu). Đúng: `<Badge status="ok" icon={<Check/>}>Đã duyệt</Badge>`.
- Bảng màu cố định `ok|warn|bad|info|idle`. Sai: tự đặt `bg-green-100`.

## Cỡ chữ, bo góc
- Cỡ chữ chỉ `text-xs … text-2xl`; bo góc chỉ `rounded-sm|md|lg`. Đúng: `text-sm rounded-md`. Sai: `text-[13px] rounded-[9px]`.

## Mobile (≤ 640px) — CR-180
Tám luật; mỗi luật một dòng + cái dùng. Máy kiểm: e2e `cr180-mobile-audit`.
1. Vùng bấm ≥ 44px, mọi cỡ. `Button` (md/sm/icon), `Tabs`, `ToggleGroup`, `Select`, `Input`, mục menu đã tự có (`max-sm:min-h-11`, token `--control-*` = 44). Link chữ đứng riêng: thêm lớp `tap-target`. Sai: `<a className="text-xs">` trần.
2. Chữ ≥ 12px (`text-xs`). Ngoại lệ: (a) số trong badge tròn nhỏ (`text-micro` 11px, ví dụ `UnreadBadge`, số «Chờ tôi»); (b) chữ trong sơ đồ phóng to/thu nhỏ/kéo được (vd Sơ đồ tổ chức — người dùng chốt 2026-11-16 giữ sơ đồ trên điện thoại) — e2e ngoại lệ `zoomCanvas`. Không thêm cỡ `text-[10px]`/`text-[11px]`. Thanh dưới: nhãn `text-xs`, 5 mục ở 360px = 72px/mục, nhãn dài bị cắt «…» (dùng `shortLabelKey`).
3. Đầu trang: `PageHeader` — tiêu đề 1 hàng, nút chính rộng hết ngay dưới, nút phụ vào «⋯» (riêng thao tác chính của trang đánh dấu `pinMobile` hiện thành nút, không giấu). Sai: 3 nút xếp hàng cạnh tiêu đề.
4. Bộ lọc: `FilterBar` — chip 1 hàng cuộn ngang (mờ mép), nâng cao vào nút «Lọc» → Sheet dưới. Sai: chip xuống 3 hàng, ô lọc chiếm nửa màn.
5. Dòng thông tin: `MetaList` — «A · B · C» ở desktop, «nhãn: giá trị» mỗi dòng ở điện thoại; không dấu «·» đầu/cuối dòng. Sai: nối chuỗi bằng `join(" · ")`.
6. Nút nổi (trợ lý): mọi vùng cuộn chính chừa đáy `pb-[var(--fab-safe)]` — `main` của Shell đã có. Vùng cuộn tự tạo (overflow-y-auto riêng) PHẢI tự thêm `pb-[var(--fab-safe)]`.
7. Lề trang 16px (`px-4`) do Shell `main` cấp; trang con KHÔNG thêm lề ngang riêng và không lồng `<main>` thứ hai (trang dùng chung có prop `embedded`, ví dụ `NotificationsPage`).
8. Một kiểu tiêu đề trang: `PageHeader` (h1 `text-2xl`). Sai: mỗi trang tự cỡ/đậm khác nhau.

## Luật cuộn — CR-187 (BR-187-8)
1. Mỗi chiều một vùng cuộn, không lồng dọc. Đúng: cả trang cuộn, hoặc chỉ khung danh sách cuộn. Sai: trang cuộn và khung bên trong cũng `overflow-y-auto`.
2. Trang thường: trang cuộn (`main` của Shell). Sai: tự đặt `h-[calc(100dvh-…)]` rồi cuộn bên trong.
3. Trang toàn màn (Tin nhắn, sơ đồ, màn ký): trang đứng yên, khung con cuộn. Đúng: khai báo đường dẫn trong `FULLSCREEN_PATHS` (`features/shell/lib/nav.ts`), khung con `min-h-0 flex-1 overflow-y-auto`. Sai: `calc(100dvh-8rem)` viết cứng.
4. Khung con chỉ cuộn khi tải dần hoặc có > 8 mục. Sai: khung cao cố định cuộn cho 3 mục.
5. Mọi vùng cuộn dọc có `scrollbar-gutter: stable`, để thanh cuộn hiện/ẩn không làm chữ nhảy ngang.

## Luật chống nháy — CR-187 (BR-187-9)
1. Đổi tab/bộ lọc: giữ dữ liệu cũ, làm mờ tới khi có dữ liệu mới. Đúng: `setData` chỉ khi có kết quả, kèm cờ `stale` để mờ. Sai: `setData(null)` khi đổi tab ⇒ trắng rồi hiện lại.
2. Số đếm không về 0 khi đang tải: giữ số cũ hoặc «–». Sai: «Chờ tôi 0» rồi nhảy thành 5.
3. Trạng thái chọn chỉ đổi màu nền/chữ, không đổi độ đậm, padding, viền. Sai: tab đang chọn `font-bold` hoặc thêm `border` ⇒ bề rộng nhảy.
4. Khung chờ đúng kích thước nội dung thật (`Skeleton` cùng cao/rộng); ảnh có `aspect-ratio` hoặc width/height. Sai: ảnh không cỡ làm trang giật khi tải xong.
5. e2e đo bounding box trước và sau khi bấm (tab, lọc, chọn): lệch ⇒ đỏ.

## Thẻ — CR-193 (L1–L4)
1. Mọi thẻ nền `--card` (sáng: trắng `#fff`) trên nền trang `--background` (`#f4f4f9`). Sai: thẻ nền xám/`muted` trên nền trang.
2. Không thẻ trong thẻ: tách phần bằng tiêu đề nhỏ hoặc đường kẻ mảnh `--row-divider`. Ngoại lệ: ô nhập liệu; khối `--muted` không viền (bong bóng bình luận, ghi chú). Sai: khung viền + bo góc lồng trong khung.
3. Mỗi trang một thanh cuộn (của trang); danh sách/bảng không cuộn riêng. Ngoại lệ: hộp thoại, danh sách thả xuống, khung Tin nhắn toàn màn.
4. Cỡ thẻ: đệm 16px (điện thoại 12px), cách nhau 12px, bo 10px.

## Hộp thoại và chuyển trang — CR-193
- BR-193-6: tiêu đề (`leading-6`) và nút «x» (ô 24×24, `flex items-center`) cùng một hàng 24px ⇒ canh giữa dọc; áp cho `DialogContent`/`SheetContent`, có hay không mô tả, điện thoại toàn màn. Sai: nút «x» `top-4` lệch so với tiêu đề.
- BR-193-7: đổi đường dẫn ⇒ vùng cuộn chính về đầu, Back/Forward ⇒ khôi phục vị trí; chỉ đổi query (lọc, tab) ⇒ không nhảy. Dùng `routerScrollOptions()` (`scroll-policy.ts`) khi tạo router; vùng cuộn chính của Shell gắn `data-scroll-restoration-id="main-scroll"`.
