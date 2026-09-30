# Tokens map — tên token → giá trị (nguồn: artboard đã duyệt)

Bảng đặt tên cho theme Tailwind/shadcn. Giá trị lấy từ `tokens.md` (sinh tự động từ 18 artboard, 2026-10-01). **Canvas thắng** khi lệch với `ui-admin.md` §5 hoặc `plan-frontend.md` §4. Chỉ light mode (dark mode chưa có trên canvas — Đề xuất ở plan-frontend).

## Màu

| Token (CSS var shadcn) | Hex | Dùng cho | Số lần |
|---|---|---|---|
| `--background` | `#F7F6FA` | Nền trang | 34 |
| `--card` / `--popover` | `#FFFFFF` | Card, drawer, dialog, topbar | 189 |
| `--foreground` | `#1D1733` | Chữ chính | 110 |
| `--muted-foreground` | `#635C78` | Chữ phụ, nhãn cột, mô tả | 275 |
| `--subtle-foreground` | `#7A7390` | Tiêu đề nhóm sidebar, caption | 16 |
| `--placeholder` | `#B3ADC4` | Dấu `/` breadcrumb, giá trị trống "—" | 9 |
| `--border` | `#E6E3EE` | Viền card, bảng, header | 122 |
| `--input` | `#D9D5E3` | Viền ô nhập, nút phụ | 75 |
| `--row-divider` | `#F0EEF4` | Đường kẻ giữa các hàng bảng | 30 |
| `--primary` | `#6B4FA0` | Nút chính, link, thanh tiến độ | 108 |
| `--primary-foreground` | `#FFFFFF` | Chữ trên nút chính | — |
| `--primary-strong` | `#4A3278` | Link hover, chữ trên nền tím nhạt | 54 |
| `--accent` | `#EDE6FB` | Mục sidebar đang chọn, badge info, nền số bước | 38 |
| `--accent-foreground` | `#4A3278` | Chữ trên `--accent` | — |
| `--ink-strong` | `#2E2150` | Panel nổi bật, avatar, chip lọc đang bật | 38 |
| `--on-ink` | `#E4DCF7` · `#C9B8FF` | Chữ phụ / link trên nền `--ink-strong` | 3 · 13 |
| `--muted` | `#EFEDF3` | Badge Tắt, nền thanh quota, skeleton | 45 |
| `--muted-strong-foreground` | `#4F4865` | Chữ trên `--muted` | 27 |
| `--secondary-foreground` | `#3B3450` | Chữ mục sidebar thường, chip lọc | 27 |
| `--success-bg` / `--success` | `#E3F4EC` / `#05603F` | Badge ok, Bật, ✓ | 25 / 24 |
| `--warning-bg` / `--warning` | `#FDF0DF` / `#7F3C04` | Badge 80% quota, Chưa gắn, banner vàng | 23 / 26 |
| `--warning-solid` | `#B45309` | Thanh quota ≥ 80% | 5 |
| `--danger-bg` / `--danger` | `#FDE8E8` / `#9B1C1C` | Badge lỗi, Vượt quota, dấu `*` bắt buộc | 23 / 34 |
| `--destructive` | `#B42318` | Nút nguy hiểm (Khoá, Xoá) | 20 |
| `--error-border` | `#D92D20` | Viền ô nhập lỗi | 8 |
| `--overage-hatch` | `#C2410C` + `#F59E0B` | Vân chéo phần vượt quota (`repeating-linear-gradient 135deg`) | 5 |
| Logo gradient | `#C9B8FF → #FFC2DD` | Chỉ trong file logo, không dùng cho UI | — |

## Chữ

| Token | Giá trị |
|---|---|
| `--font-sans` | `'Be Vietnam Pro', system-ui, sans-serif` (400 · 500 · 600 · 700) |
| `--font-mono` | `'JetBrains Mono', ui-monospace, monospace` (400 · 500) — tên command, key, id, số tiền |
| Thang cỡ chữ | 11 (nhãn nhỏ) · **12** (caption, badge) · **13** (nhãn, phụ) · **14** (body, bảng) · 15–16 (tiêu đề card) · 18 (tiêu đề dialog) · 22–24 (tiêu đề trang) · 28 (số KPI) · 40 (tiêu đề màn đăng nhập) |
| Độ đậm | 500 nhãn/nút · 600 tiêu đề/mục chọn · 700 tiêu đề trang, số KPI |

## Hình khối

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--radius-sm` | 4px | Phím tắt `kbd`, cột biểu đồ |
| `--radius` (md) | 6px · **8px** | Nút, ô nhập, chip nhỏ (8px là chính, 107 lần) |
| `--radius-lg` | 10–12px | Card (12), khung kết quả / toast (10) |
| `--radius-full` | 999px | Badge, avatar, chip lọc |
| Chiều cao | nút & ô nhập **36px** · nút nhỏ 30–32px · nút lớn / ô đăng nhập 40–44px · badge 22px · mục sidebar 36px · topbar 60px |
| Bố cục | sidebar **248px** · nội dung tối đa 1280px · padding trang 28px · khoảng cách card 16–20px · card padding 16–20px |
| Bóng | toast `0 8px 24px rgba(29,23,51,.25)` · dialog `0 20px 48px rgba(29,23,51,.28)` · drawer `-12px 0 32px rgba(29,23,51,.18)` |
