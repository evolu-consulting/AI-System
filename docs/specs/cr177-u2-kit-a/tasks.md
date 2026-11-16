---
id: cr177-u2-kit-a
lát: cr177-u2-kit-a
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Nhóm A của bộ component chung CR-177: 11 file trong `packages/web-kit/src/ui/kit/` (copy gốc shadcn admin-web, chỉnh theo token U1).

## Làm
button, tooltip, input, textarea, select, checkbox, switch, badge, avatar, field + README.md + test `kit-a.test.tsx`.

## Không làm / Chạm
Không chuyển app sang dùng; không sửa `components/ui` của app, `PersonAvatar`, package.json, tokens.css; không đụng file nhóm B (lát U3).

## Test tối thiểu
`bun test packages/web-kit/src/ui/kit` · `tsc --noEmit -p packages/web-kit` · biome file mới.

## Quyết định trong lúc làm
- Không render DOM (react-dom không có trong web-kit): test duyệt cây phần tử, gọi trực tiếp hàm component (không dùng hook trong component nhóm A).
- `Field` nhận `id` tường minh (không `useId`) để test được và id ổn định.
- `Button` busy: nhãn giữ trong `span.invisible` + spinner tuyệt đối để giữ chiều rộng; với `asChild` chỉ đặt `aria-busy`.
- `Tooltip` tự bọc `Provider` (trễ 250ms) để `Button` dùng độc lập.
- `size="icon"` chỉ một cỡ (control-md, vuông); `Avatar` dùng chữ cái đầu của `PersonAvatar` (import `avatarInitials`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/giao-dien-chung.md
#### Yêu cầu: Nút chung
Nút có 4 biến thể (chính, viền, nhạt, nguy hiểm), cỡ md/sm/icon theo token; nút chỉ icon bắt buộc nhãn đọc.
- Kịch bản: khi chọn biến thể và cỡ thì nút ra đúng màu, chiều cao, bo góc [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » biến thể ra đúng class; packages/web-kit/src/ui/kit/kit-a.test.tsx » cỡ md/sm/icon theo --control-* và bo góc]
- Kịch bản: khi nút chỉ icon thiếu nhãn đọc thì lỗi kiểu lúc biên dịch [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » nút chỉ icon thiếu aria-label ⇒ lỗi kiểu]

#### Yêu cầu: Khoá kèm lý do và đang xử lý
Nút khoá nói lý do (rê/focus), vẫn focus được; nút đang xử lý có spinner, không bấm được, không đổi chiều rộng.
- Kịch bản: khi nút khoá có lý do bị bấm thì không chạy thao tác và hiện lý do [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » disabledReason ⇒ aria-disabled, không gọi onClick, bọc Tooltip có lý do]
- Kịch bản: khi nút đang xử lý thì có aria-busy, spinner và không chạy thao tác [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » busy ⇒ aria-busy, spinner, chặn click, vẫn giữ nhãn (giữ chiều rộng)]

#### Yêu cầu: Chú giải và ô nhập
Chú giải hiện sau 250ms; ô nhập cao theo token, viền đỏ khi sai; nhãn/mô tả/lỗi gắn vào ô qua aria.
- Kịch bản: khi rê vào thì chú giải trễ 250ms [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » trễ 250ms]
- Kịch bản: khi ô sai thì có aria-invalid và lỗi được đọc qua aria-describedby [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » Field gắn id, aria-describedby (mô tả + lỗi) và aria-invalid vào control; packages/web-kit/src/ui/kit/kit-a.test.tsx » Input cao control-md, có viền danger khi aria-invalid, nền muted khi disabled]

#### Yêu cầu: Nhãn trạng thái và avatar
Nhãn trạng thái dùng 5 màu cố định và luôn có icon; avatar người tròn, công ty vuông bo; nhóm avatar tối đa 3 rồi «+N».
- Kịch bản: khi hiện nhãn thì đúng màu theo trạng thái và có icon [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » mỗi trạng thái một màu và luôn có icon]
- Kịch bản: khi nhóm có 5 người thì hiện 3 avatar và «+2» [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » AvatarGroup 5 người ⇒ 3 avatar + «+2»; packages/web-kit/src/ui/kit/kit-a.test.tsx » người tròn, công ty vuông bo 28%, cỡ 24/32/40]

## Việc còn lại
Select, Checkbox, Switch, Textarea chưa có test riêng (bọc Radix, kiểm khi chuyển app/e2e).
