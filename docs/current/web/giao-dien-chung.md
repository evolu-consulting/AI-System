# Bộ giao diện chung (CR-177): token + component

Gói `packages/web-kit` (`src/styles/tokens*`, `src/ui/kit/**`). Luật dùng và bảng icon: [giao-dien-chung-luat.md](giao-dien-chung-luat.md) · bản cho người code: `packages/web-kit/src/ui/kit/RULES.md`. Lớp nổi (hộp thoại, ô chọn, xác nhận, Hoàn tác): [giao-dien-chung-lop-noi.md](giao-dien-chung-lop-noi.md). Luật điện thoại: [mobile.md](mobile.md).

## Token
#### Yêu cầu: Token màu, chữ, bo góc dùng chung (nguồn: cr177-u1-tokens; code: `packages/web-kit/src/styles/`)
Mọi app lấy màu, 6 cỡ chữ (xs 12 · sm 13 · md 14 · lg 16 · xl 20 · 2xl 24), 3 mức bo góc (6 · 10 · 16), chiều cao nút (40/32, điện thoại 44/40) và thời lượng toast (3 giây; có «Hoàn tác» 6 giây) từ một gói chung. Mỗi màu một tên gốc; tên cũ là bí danh trỏ về tên gốc (bí danh tạm + tên ngữ nghĩa cũ `text-body`… còn tồn tại tới khi các app chuyển hết). Mỗi màu sáng có bản tối.
- Kịch bản: khi tra gói token thì mỗi màu sáng đều có bản tối và mọi bí danh trỏ tới token có thật [test: packages/web-kit/src/styles/tokens.test.ts » mỗi token khai ở :root có mặt ở khối tối; packages/web-kit/src/styles/tokens.test.ts » bí danh trỏ tới token có thật]
- Kịch bản: khi tra thang chữ và bo góc thì có đúng 6 cỡ chữ và 3 mức bo góc [test: packages/web-kit/src/styles/tokens.test.ts » đúng 6 cỡ chữ; packages/web-kit/src/styles/tokens.test.ts » đúng 3 mức bo góc]
- Kịch bản: khi hiện thông báo thì thường tự ẩn sau 3 giây, có «Hoàn tác» sau 6 giây [test: packages/web-kit/src/styles/tokens.test.ts » toast thường 3 giây]

## Component
#### Yêu cầu: Nút chung (nguồn: cr177-u2-kit-a)
4 biến thể (chính, viền, nhạt, nguy hiểm), cỡ md/sm/icon theo token (các cỡ cũ `xs`/`icon-sm`/`lg` đã gộp về `sm`/`icon`/`md`); nút chỉ icon bắt buộc nhãn đọc (`aria-label`, lỗi kiểu lúc biên dịch).
- Kịch bản: khi chọn biến thể và cỡ thì nút ra đúng màu, chiều cao, bo góc [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » biến thể ra đúng class; packages/web-kit/src/ui/kit/kit-a.test.tsx » cỡ md/sm/icon theo --control-* và bo góc]
- Kịch bản: khi nút chỉ icon thiếu nhãn đọc thì lỗi kiểu lúc biên dịch [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » nút chỉ icon thiếu aria-label ⇒ lỗi kiểu]

#### Yêu cầu: Khoá kèm lý do và đang xử lý (nguồn: cr177-u2-kit-a)
Nút khoá nói lý do (rê/focus), vẫn focus được, bấm không chạy thao tác; nút đang xử lý có spinner, `aria-busy`, không bấm được, không đổi chiều rộng.
- Kịch bản: khi nút khoá có lý do bị bấm thì không chạy thao tác và hiện lý do [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » disabledReason ⇒ aria-disabled, không gọi onClick, bọc Tooltip có lý do]
- Kịch bản: khi nút đang xử lý thì có aria-busy, spinner và không chạy thao tác [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » busy ⇒ aria-busy, spinner, chặn click, vẫn giữ nhãn (giữ chiều rộng)]

#### Yêu cầu: Chú giải và ô nhập (nguồn: cr177-u2-kit-a)
Chú giải hiện sau 250 ms; ô nhập cao theo token, viền đỏ khi sai, nền muted khi khoá; nhãn/mô tả/lỗi gắn vào ô qua aria. Select, Checkbox, Switch, Textarea bọc Radix (chưa có test riêng; kiểm qua e2e các màn). Trong `<form>` ô Select của Radix có thể sinh thêm `<select aria-hidden>` — e2e dùng `getByRole("combobox", { name })` thay `getByLabel` (nguồn: cr177-w2-fields).
- Kịch bản: khi rê vào thì chú giải trễ 250ms [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » trễ 250ms]
- Kịch bản: khi ô sai thì có aria-invalid và lỗi được đọc qua aria-describedby [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » Field gắn id, aria-describedby (mô tả + lỗi) và aria-invalid vào control; packages/web-kit/src/ui/kit/kit-a.test.tsx » Input cao control-md, có viền danger khi aria-invalid, nền muted khi disabled]

#### Yêu cầu: Nhãn trạng thái và avatar (nguồn: cr177-u2-kit-a)
Nhãn trạng thái 5 màu cố định, luôn có icon; avatar người tròn, công ty vuông bo (28%), cỡ 24/32/40; nhóm avatar tối đa 3 rồi «+N».
- Kịch bản: khi hiện nhãn thì đúng màu theo trạng thái và có icon [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » mỗi trạng thái một màu và luôn có icon]
- Kịch bản: khi nhóm có 5 người thì hiện 3 avatar và «+2» [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » AvatarGroup 5 người ⇒ 3 avatar + «+2»; packages/web-kit/src/ui/kit/kit-a.test.tsx » người tròn, công ty vuông bo 28%, cỡ 24/32/40]

#### Yêu cầu: Một avatar người dùng ở header, sidebar, menu điện thoại (nguồn: cr179-community-avatar)
Cùng component `UserAvatar`, cùng chữ cái đầu, ảnh, màu nền (màu chính nhạt), cỡ 24/32/40.
- Kịch bản: mọi cỡ cùng lớp màu; header và menu đều dùng UserAvatar [test: packages/web-kit/src/ui/UserAvatar.test.tsx » UserAvatar]
- Kịch bản: avatar header và sidebar cùng màu nền [test: e2e/community-web/cr147-feed.cm.ts » CR-179: avatar header và sidebar cùng màu nền]

## Chuyển app sang bộ chung (nguồn: cr177-a3-admin, w2-fields, w3a/w3b-buttons — không đổi hành vi)
Admin, Sổ Hợp Tác, Bảng tin, Cài đặt, Đối tác đã dùng nút/ô/tooltip của kit (chữ, luồng, testid giữ nguyên; nút khoá nay có lý do khi rê). Còn lại (nợ, đo bằng `check:ui-kit`): `PageHeader`/`PageHead`, `ConnectionBanner`, `IconButton` của admin; ~23 `<button>` ở Sổ Hợp Tác (chọn dòng trong ô tìm, tab/chip tự dựng, phân trang `Pager`, hàng gập, đổi ngôn ngữ) và nhiều nút tab/chip/menu ở Bảng tin/Cài đặt (PostMenu, UserMenu, DockTabs, AccentPicker, AssistantFab…); `title=` ở TruncText/Tag/Sidebar/RepBadge…; `.btn*` trong `globals.css` chưa gỡ; icon «tiếp/sau», ★ ⚑ ‹ › chưa có trong `icons.ts`; ToggleGroup chưa áp cho tab/chip.
