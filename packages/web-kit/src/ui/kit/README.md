# Bộ component chung (CR-177) — nhóm A

Import: `@ai/web-kit/ui/kit/<tên>`. Màu/cỡ/bo góc lấy từ `styles/tokens.css`; `cn` ở `cn.ts`. Nhóm B (Dialog, Sheet, Menu, Tabs…) do lát U3.

- `button` — `<Button variant="primary|outline|quiet|danger" size="md|sm">Lưu</Button>`
- `button` (icon) — `<Button size="icon" aria-label="Đóng"><X /></Button>` (thiếu `aria-label` ⇒ lỗi kiểu)
- `button` (khoá có lý do) — `<Button disabledReason="Chưa đủ quyền">Duyệt</Button>` (vẫn focus được, rê/focus hiện lý do)
- `button` (đang xử lý) — `<Button busy>Lưu</Button>` (spinner, chặn bấm, giữ chiều rộng)
- `tooltip` — `<Tooltip><TooltipTrigger asChild>…</TooltipTrigger><TooltipContent>Gợi ý</TooltipContent></Tooltip>`
- `input` / `textarea` — `<Input aria-invalid />` · `<Textarea />`
- `select` — `<Select><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a">A</SelectItem></SelectContent></Select>`
- `checkbox` / `switch` — `<Checkbox checked onCheckedChange={…} />` · `<Switch checked onCheckedChange={…} />`
- `badge` — `<Badge status="ok|warn|bad|info|idle" icon={<Check />}>Đã duyệt</Badge>` (icon bắt buộc)
- `avatar` — `<Avatar name="An Bình" kind="person|company" size={32} />` · `<AvatarGroup people={[…]} />` (tối đa 3 + «+N»)
- `field` — `<Field id="ten" label="Tên" description="…" error="…"><Input /></Field>` (gắn `aria-describedby`/`aria-invalid`)
- `trunc-text` — `<TruncText text="Tên đầy đủ" lines={1|2} className="…" />` (cắt «…»; chỉ khi tràn mới có tooltip đủ chữ + focus bàn phím; thay `truncate` trần/`title=`)

Test: `kit-a.test.tsx` (bun test, không render DOM: duyệt cây phần tử).

## Mobile (CR-180)
- `page-header` — `<PageHeader title description? primary={<Button>…</Button>} actions={[{label, icon?, onSelect, danger?, disabled?, reason?}]}>{tab/lọc}</PageHeader>`
- `filter-bar` — `<FilterBar chips={<ToggleGroup…/>} advanced={<Select…/>} activeCount={2} />` (điện thoại: chip cuộn ngang + nút «Lọc» mở Sheet)
- `meta-list` — `<MetaList items={[{label:"Đối tác", value:"ABC"}, …]} />` (mục rỗng tự bỏ)
- lớp `tap-target` — link chữ đứng riêng: `<a className="tap-target …">` (≥ 44px trên điện thoại)
Test: `apps/workspace-web/src/components/shared/mobile-kit.test.tsx`.
