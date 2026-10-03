# Plan frontend C1 · Phụ lục: giao diện Sáng + Tối (CR-027)

Phụ lục của `plan-frontend.md` §5 (SettingsDialog), §9, §14 H2. Gate C1 §3b: người dùng chọn **Sáng + Tối** + "Theo hệ thống" (ui-chat §7). Sáng = `docs/design/canvas/tokens-map.md` (canvas thắng); Tối = frontend-lead đề xuất, cùng tông tím EvoluConsulting, đạt AA (ui-chat §11). Task: F14.

## 1. Token ngữ nghĩa
Tỉ lệ WCAG 2.x tính bằng script `node` (luminance sRGB). Ngưỡng: chữ **≥ 4.5**, viền/icon cần nhận biết **≥ 3**; viền trang trí không có ngưỡng.

| Token (CSS var) | Vai trò | Sáng | Tối |
|---|---|---|---|
| `--background` | nền trang | `#F7F6FA` | `#14111C` |
| `--card` / `--popover` | surface: sidebar, khung flow, dialog | `#FFFFFF` | `#1C1828` |
| `--muted` | surface-muted: skeleton, badge Tắt | `#EFEDF3` | `#262037` |
| `--row-divider` | **bubble user**, kẻ hàng | `#F0EEF4` | `#2A2340` |
| `--border` | viền card/FlowBlock (trang trí) | `#E6E3EE` | `#352D4A` |
| `--input` | viền ô nhập, nút phụ | `#D9D5E3` | `#6E6589` |
| `--foreground` | chữ chính | `#1D1733` | `#ECE8F5` |
| `--muted-foreground` | chữ phụ | `#635C78` | `#A9A2BD` |
| `--subtle-foreground` | caption, nhóm sidebar | `#736C89` | `#958DAD` |
| `--placeholder` | "—", `/` (trang trí) | `#B3ADC4` | `#6E6786` |
| `--primary` | nút chính, link, **ring**, **viền flow đang mở**, viền AskCard | `#6B4FA0` | `#A58BDB` |
| `--primary-foreground` | chữ trên nút chính | `#FFFFFF` | `#14111C` |
| `--primary-strong` | "Consultant", link hover | `#4A3278` | `#C9B8FF` |
| `--accent` / `--accent-foreground` | primary-soft: mục sidebar đang chọn | `#EDE6FB` / `#4A3278` | `#2E2150` / `#D9CCFF` |
| `--ink-strong` / `--on-ink` | panel nổi bật, avatar | `#2E2150` / `#E4DCF7` | `#3A2A66` / `#E4DCF7` |
| `--muted-strong-foreground` | chữ trên `--muted` | `#4F4865` | `#C4BED6` |
| `--secondary-foreground` | chữ mục sidebar | `#3B3450` | `#CFC9DF` |
| `--success-bg` / `--success` | | `#E3F4EC` / `#05603F` | `#0F2E22` / `#6EE7B7` |
| `--warning-bg` / `--warning` | banner "Đang kết nối lại…" | `#FDF0DF` / `#7F3C04` | `#33220C` / `#FBBF6A` |
| `--warning-solid` | thanh ≥ 80% | `#B45309` | `#F59E0B` |
| `--danger-bg` / `--danger` | ErrorCard, banner đỏ | `#FDE8E8` / `#9B1C1C` | `#3A1518` / `#FCA5A5` |
| `--destructive` (+ chữ trắng) | nút Xoá | `#B42318` | `#B42318` |
| `--error-border` | viền ô lỗi | `#D92D20` | `#F97066` |
| `--ring` | focus ring 2px + offset 2px | = `--primary` | = `--primary` |
| `--code-bg` / `--code-fg` | khối code | `#F6F4FA` / `#1D1733` | `#100D17` / `#E6E1F2` |
| `--code-{keyword,string,number,title,comment}` | màu hljs | `#8A3FA8` `#0B6B3A` `#9A4A00` `#2A55A8` `#6B6580` | `#D7A6F0` `#8FD9A8` `#F2B872` `#9DB8F5` `#9790AD` |

Bóng ở Tối: `rgba(0,0,0,.5)`, cùng kích thước.

## 2. Tương phản đã tính

| Cặp | Sáng | Tối | Ngưỡng |
|---|---|---|---|
| foreground / background · / card | 15.96 · 17.18 | 15.47 · 14.40 | 4.5 |
| muted-fg / card · / background · / muted | 6.30 · 5.86 · 5.42 | 7.10 · 7.62 · 6.39 | 4.5 |
| subtle-fg / background · / card | 4.61 · 4.96 | 5.94 · 5.53 | 4.5 |
| foreground / bubble user | 14.92 | 12.33 | 4.5 |
| primary-fg / primary (nút) | 6.46 | 6.49 | 4.5 |
| primary (link) / card | 6.46 | 6.04 | 4.5 |
| primary-strong / card | 10.40 | 9.73 | 4.5 |
| accent-fg / accent · muted-fg / accent | 8.58 · 5.19 | 9.68 · 5.93 | 4.5 |
| on-ink / ink-strong | 10.95 | 9.32 | 4.5 |
| muted-strong-fg / muted · secondary-fg / card | 7.39 · 11.71 | 8.69 · 10.80 | 4.5 |
| success · warning · danger trên nền của nó | 6.69 · 7.33 · 6.94 | 9.61 · 9.28 · 8.51 | 4.5 |
| trắng / destructive | 6.57 | 6.57 | 4.5 |
| code fg · keyword · string · number · title · comment / code-bg | 15.74 · 5.73 · 6.05 · 5.74 · 6.49 · 5.07 | 15.03 · 9.71 · 11.59 · 10.87 · 9.71 · 6.33 | 4.5 |
| primary (ring, viền flow mở) / background · / card | 6.00 · 6.46 | 6.49 · 6.04 | 3 |
| error-border / card · warning-solid / muted | 4.83 · 4.32 | 6.23 · 7.27 | 3 |
| input / card | **1.44** | 3.21 | 3 |

Ngoại lệ có chủ đích: `--input` Sáng 1.44 là giá trị canvas (canvas thắng); ô nhập luôn có nhãn hiển thị + placeholder + ring 6.46 khi focus. Ghi TECH-DEBT "viền ô nhập Sáng < 3:1, chờ designer". Tối đã ≥ 3.

## 3. Cách áp dụng

| Mục | Cách |
|---|---|
| CSS | `src/styles/globals.css`: `:root { …Sáng }` + `.dark { …Tối }` (đủ mọi var bảng §1); `@theme inline` ánh xạ var → màu Tailwind (như admin-web). Component chỉ dùng class token, không hex |
| Tailwind v4.3 | Không có `tailwind.config` → tương đương `darkMode: 'class'` là `@custom-variant dark (&:is(.dark *));` (giống admin-web). Hầu như không cần `dark:` vì đổi qua var; `dark:` chỉ cho logo (§4) |
| Lớp gốc | class `dark` trên `<html>`; `<html style="color-scheme: light|dark">` (thanh cuộn, ô nhập native); `<meta name="color-scheme" content="light dark">` |
| Lưu lựa chọn | `localStorage['ai-chat-theme']` = `light` \| `dark` \| `system` (mặc định `system`); đọc/ghi trong try/catch, lỗi → `system`, không lưu được thì vẫn đổi trong phiên |
| Không nháy | script inline **trước** CSS trong `index.html` (đồng bộ, ~400 B): đọc khoá, `system` → `matchMedia('(prefers-color-scheme: dark)')`, gắn `dark` + `color-scheme` lên `documentElement`. Không đợi React |
| Runtime | `src/lib/theme.ts`: `getTheme`, `setTheme(mode)` (lưu + áp), `resolve(mode, mql)`; `system` → nghe `change` của `matchMedia`; sự kiện `storage` → đồng bộ tab khác. Hàm thuần có unit test |
| Cài đặt | SettingsDialog thêm nhóm **Giao diện** = shadcn `RadioGroup` (`role=radiogroup` tên "Giao diện", 3 `radio` Sáng/Tối/Theo hệ thống); đổi là áp ngay, không có nút Lưu. Trang `/login` theo lựa chọn đã lưu/hệ thống (không có nút chọn) |

## 4. Logo trên nền tối
Icon (`evoluconsulting-icon.svg`: ô gradient `#C9B8FF→#FFC2DD` + nét trắng) rõ trên nền tối (9.73:1). Logo ngang có chữ `#2E2150` → trên `#14111C` chỉ **1.29:1**, không dùng.
Cách làm: component `BrandLogo` (`src/components/shared/`) render **hai** biến thể, CSS chọn: Sáng `<img logo-horizontal>` (`dark:hidden`); Tối `icon.svg` + chữ HTML "EvoluConsulting" (600, `--foreground`) + "INTELLIGENT AUTOMATION" (`--subtle-foreground`, chữ hoa, giãn chữ) (`hidden dark:flex`). Tên thương hiệu là hằng trong `lib/brand.ts`, không qua i18n. Avatar Consultant + logo Welcome 48px dùng icon → không đổi.

## 5. highlight.js
Không nạp theme CSS của hljs (`github.css`/`github-dark.css` phải đổi file theo chế độ). Viết ~15 dòng trong `globals.css`: `.hljs{background:var(--code-bg);color:var(--code-fg)}`, `.hljs-keyword,.hljs-built_in`→`--code-keyword`, `.hljs-string`→`--code-string`, `.hljs-number,.hljs-literal`→`--code-number`, `.hljs-title,.hljs-attr`→`--code-title`, `.hljs-comment`→`--code-comment` (italic). Đổi theme = đổi var, không tải lại chunk (ADR-0006 không đổi kích thước).

## 6. Đề xuất cho qc
| # | Ca | Loại |
|---|---|---|
| T1 | Mở Cài đặt → `radio "Tối"` → `html` có class `dark`, `getComputedStyle(body).backgroundColor` = `rgb(20, 17, 28)`; tải lại trang vẫn Tối; chọn "Theo hệ thống" với `colorScheme: 'dark'` (Playwright `emulateMedia`) → Tối, `'light'` → Sáng | e2e |
| T2 | Không nháy: `localStorage['ai-chat-theme']='dark'` qua `addInitScript`, mở `/login` → ngay ở `domcontentloaded` `html.dark` đã có (trước khi bundle React chạy); `localStorage` ném lỗi → trang vẫn hiện (Sáng/hệ thống) | e2e |
| T3 | Tương phản: đọc `apps/chat-web/src/styles/globals.css`, tách `:root` / `.dark`, tính WCAG cho các cặp bảng §2 (chữ ≥ 4.5, ring/viền flow/error-border ≥ 3; trừ `--input` Sáng) | unit acceptance |
