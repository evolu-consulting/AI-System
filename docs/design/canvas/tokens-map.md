# Tokens map — tên token → giá trị (nguồn: artboard đã duyệt)

Bảng đặt tên cho theme Tailwind/shadcn. Giá trị lấy từ `tokens.md` (sinh tự động từ 18 artboard, 2026-10-01). **Canvas thắng** khi lệch với `ui-admin.md` §5 hoặc `plan-frontend.md` §4. Chỉ light mode (dark mode chưa có trên canvas — Đề xuất ở plan-frontend).

**UI-1 (CR-049, 2026-10-07): bảng màu indigo theo designer — chỉ đổi màu.** Cột "Hex (từ UI-1)" là nguồn chân lý cho cả 3 app (admin-web, chat-web, studio-web); cột "Trước UI-1" giữ giá trị canvas đã duyệt để truy vết (các file `*.dc.html` chưa vẽ lại, **tokens-map thắng** khi lệch). Giữ font, bố cục, bo góc, kích thước, câu chữ. Màu trạng thái (success/warning/danger/destructive/error-border/overage) giữ nguyên vì đã chỉnh AA (xanh/cam của designer không đạt AA cho chữ). Tỉ số tính bằng công thức WCAG 2.x: mọi cặp chữ ≥ 4,5:1; `--placeholder`, `--border`, `--row-divider` chỉ trang trí. **Dark mode Chat (CR-027):** xem mục "Dark mode (UI-1)" cuối file.

## Màu

| Token (CSS var shadcn) | Hex (từ UI-1) | Trước UI-1 (canvas cũ) | Dùng cho | Số lần | Tương phản (WCAG) |
|---|---|---|---|---|---|
| `--background` | **`#F4F4F9`** | `#F7F6FA` | Nền trang | 34 | fg 18,06:1 |
| `--card` / `--popover` | **`#FFFFFF`** | `#FFFFFF` | Card, drawer, dialog, topbar | 189 | fg 19,80:1 |
| `--foreground` | **`#0A0A0A`** | `#1D1733` | Chữ chính | 110 | nền 18,06:1 · card 19,80:1 |
| `--muted-foreground` | **`#6B6B6B`** | `#635C78` | Chữ phụ, nhãn cột, mô tả | 275 | bg 4,86:1 · card 5,33:1 · muted 4,89:1 · accent 4,77:1 |
| `--subtle-foreground` | **`#6B6B6B`** | `#736C89` | Tiêu đề nhóm sidebar, caption. Chỉnh cho AA, lệch canvas có chủ đích (canvas `#7A7390` = 4.17:1 trên nền, 4.48:1 trên trắng); `#736C89` = 4.61:1 trên `#F7F6FA`, 4.96:1 trên `#FFFFFF` | 16 | như muted-foreground (gộp, hết cần chỉnh riêng) |
| `--placeholder` | **`#A3A3A3`** | `#B3ADC4` | Dấu `/` breadcrumb, giá trị trống "—" | 9 | 2,52:1 — chỉ trang trí (dấu `/`, "—"), không dùng cho chữ cần đọc |
| `--border` | **`#E5E5E5`** | `#E6E3EE` | Viền card, bảng, header | 122 | trang trí (1,26:1 trên trắng) |
| `--input` | **`#D4D4D8`** | `#D9D5E3` | Viền ô nhập, nút phụ | 75 | 1,48:1 trên trắng (viền ô nhập; trước UI-1 cũng < 3:1 — ghi nhận, cải thiện nếu cần ở UI-1) |
| `--row-divider` | **`#F5F5F5`** | `#F0EEF4` | Đường kẻ giữa các hàng bảng | 30 | trang trí |
| `--primary` | **`#4F46E5`** | `#6B4FA0` | Nút chính, link, thanh tiến độ | 108 | trên trắng 6,29:1 · bg 5,74:1 · accent 5,62:1 |
| `--primary-foreground` | **`#FFFFFF`** | `#FFFFFF` | Chữ trên nút chính | — | trên primary 6,29:1 |
| `--primary-strong` | **`#4338CA`** | `#4A3278` | Link hover, chữ trên nền tím nhạt | 54 | trắng 7,90:1 · accent 7,07:1 |
| `--accent` | **`#EEF2FF`** | `#EDE6FB` | Mục sidebar đang chọn, badge info, nền số bước | 38 | — |
| `--accent-foreground` | **`#3730A3`** | `#4A3278` | Chữ trên `--accent` | — | trên accent 8,88:1 |
| `--ink-strong` | **`#1E1B4B`** | `#2E2150` | Panel nổi bật, avatar, chip lọc đang bật | 38 | trắng trên ink 15,99:1 |
| `--on-ink` | **`#E0E7FF` · `#A5B4FC`** | `#E4DCF7` · `#C9B8FF` | Chữ phụ / link trên nền `--ink-strong` | 3 · 13 | 12,98:1 · 8,02:1 trên ink |
| `--muted` | **`#F5F5F5`** | `#EFEDF3` | Badge Tắt, nền thanh quota, skeleton | 45 | — |
| `--muted-strong-foreground` | **`#525252`** | `#4F4865` | Chữ trên `--muted` | 27 | trên muted 7,17:1 |
| `--secondary-foreground` | **`#404040`** | `#3B3450` | Chữ mục sidebar thường, chip lọc | 27 | card 10,37:1 · bg 9,46:1 |
| `--success-bg` / `--success` | `#E3F4EC` / `#05603F` (giữ nguyên) | `#E3F4EC` / `#05603F` | Badge ok, Bật, ✓ | 25 / 24 | đã chỉnh AA, không đổi |
| `--warning-bg` / `--warning` | `#FDF0DF` / `#7F3C04` (giữ nguyên) | `#FDF0DF` / `#7F3C04` | Badge 80% quota, Chưa gắn, banner vàng | 23 / 26 | đã chỉnh AA, không đổi |
| `--warning-solid` | `#B45309` (giữ nguyên) | `#B45309` | Thanh quota ≥ 80% | 5 | đã chỉnh AA, không đổi |
| `--danger-bg` / `--danger` | `#FDE8E8` / `#9B1C1C` (giữ nguyên) | `#FDE8E8` / `#9B1C1C` | Badge lỗi, Vượt quota, dấu `*` bắt buộc | 23 / 34 | đã chỉnh AA, không đổi |
| `--destructive` | `#B42318` (giữ nguyên) | `#B42318` | Nút nguy hiểm (Khoá, Xoá) | 20 | đã chỉnh AA, không đổi |
| `--error-border` | `#D92D20` (giữ nguyên) | `#D92D20` | Viền ô nhập lỗi | 8 | đã chỉnh AA, không đổi |
| `--overage-hatch` | `#C2410C` + `#F59E0B` (giữ nguyên) | `#C2410C` + `#F59E0B` | Vân chéo phần vượt quota (`repeating-linear-gradient 135deg`) | 5 | đã chỉnh AA, không đổi |
| Logo gradient | **`#818CF8 → #C4B5FD`** (UI-1, người dùng 2026-10-07 "đổi tông luôn"; chữ logo `#1E1B4B`/`#4F46E5`/`#6366F1`, tagline `#6B6B8A`) | `#C9B8FF → #FFC2DD` | Chỉ trong file logo, không dùng cho UI | — | — |

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

## Dark mode (UI-1, CR-049) — chat-web `.dark` (admin/studio: tập con đang có, cùng giá trị)

Suy ra bởi frontend-lead 2026-10-07; tỉ số WCAG 2.x tính bằng script. Chữ ≥ 4,5:1, thành phần UI ≥ 3:1. Màu trạng thái giữ bộ tối cũ (đã AA).

| Token | Hex tối | Tỉ số |
|---|---|---|
| `--background` / `--card`,`--popover`,`--sidebar` / `--muted`,`--secondary` | `#0F1020` / `#171833` / `#1F2142` | — |
| `--foreground` | `#E8EAF6` | bg 15,72 · card 14,43 |
| `--muted-foreground` | `#A9AED0` | bg 8,65 · card 7,94 · muted 7,13 |
| `--muted-strong-foreground` | `#C7CBE6` | muted 9,68 |
| `--subtle-foreground` | `#9CA1C7` | bg 7,47 · card 6,86 |
| `--secondary-foreground` | `#D2D5EC` | card 11,91 |
| `--primary` / `--ring` | `#818CF8` | bg 6,31 · card 5,79 · muted 5,20 · accent 5,36 |
| `--primary-foreground` | `#0F1020` | trên primary 6,31 |
| `--primary-strong` | `#A5B4FC` | card 8,67 |
| `--accent` / `--accent-foreground` | `#1E1B4B` / `#C7D2FE` | 10,72 |
| `--ink-strong` / `--on-ink` / `--on-ink-link` | `#312E81` / `#E0E7FF` / `#A5B4FC` | 9,27 · 5,73 |
| `--input` (viền ô nhập) | `#6670A8` | card 3,66 · bg 3,99 · muted 3,28 (UI ≥ 3) |
| `--border`, `--row-divider`, `--placeholder` | `#2A2D52`, `#1F2142`, `#6E7299` | trang trí |
| `--destructive` (chữ trắng) | `#B42318` | 6,57 |
| `--error-border` | `#F97066` | card 6,20 |
| success / warning / danger trên bg tương ứng | giữ nguyên | 9,61 · 9,28 · 8,51 |
| `--code-bg` / `--code-fg` | `#0B0C18` / `#E6E8F5` | 15,95 · keyword 9,82 · string 11,72 · number 10,99 · title 9,82 · comment `#9A9FC2` 7,51 |
| `--chart-1..4` | `#818CF8` `#6366F1` `#A5B4FC` `#C7D2FE` | card 5,79 · 3,87 · 8,67 · 11,59 |

Light bổ sung: `--sidebar` `#FAFAFD`, chart `#4F46E5 #818CF8 #1E1B4B #A5B4FC`, `--code-bg` `#F5F5FA`, `--code-comment` `#6B6B6B` (4,90:1), bóng `rgb(30 27 75 / …)`.
