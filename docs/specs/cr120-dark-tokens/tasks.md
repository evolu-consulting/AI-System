---
id: cr120-dark-tokens
lát: cr120-dark-tokens
cr: CR-120
làn: nhanh
migration: không
phụ thuộc: cr120-one-shell
---
## Plan (ngắn)
Giao diện tối của /community đọc không được (chữ sáng trên nền sáng) vì CSS Community còn màu hex/rgba cứng. Thay hết bằng token của shell (`globals.css`, có bản sáng + tối), thêm test chặn tái phát, thêm e2e đo tương phản ở cả hai giao diện.

## Làm
- 68 literal màu trong `community/ui/styles/*.css` (feed, mockup, profile, shell, accent) → token shell (`--card`, `--sunk`, `--rule`, `--accent`, `--success*`, `--danger*`, `--destructive`, `--soon-line`, `--shadow-color-*`, `--type-*` giữ nguyên); độ trong suốt dùng `color-mix`.
- Màu thương hiệu công ty (`data-accent` blue/teal/green/orange/rose) chuyển về `globals.css` thành `--brand-<tên>` (một giá trị sáng + một tối); hover/soft/ink suy ra bằng `color-mix` trong `accent.css`.
- Test chặn: `apps/workspace-web/src/styles/no-literal-colors.test.ts`.
- e2e: `e2e/community-web/contrast.cm.ts` (Tối/Sáng × bảng tin/Sổ Hợp Tác; không có axe trong repo ⇒ tính tỉ lệ WCAG từ getComputedStyle).

## Không làm / Chạm
Không đổi bố cục, không thêm bộ token riêng; không chạm engine, DLC. Perf: chỉ CSS, không chi phí chạy.

## Test tối thiểu
unit `no-literal-colors.test.ts` + `scope.test.ts`; một spec e2e `contrast.cm.ts` chạy riêng qua evotest `-Step e2e -All -Filter`.

## Quyết định trong lúc làm
- Token file duy nhất cho literal màu = `apps/workspace-web/src/styles/globals.css`.
- Brand accent dùng `color-mix` thay vì 4 giá trị × 5 màu × 2 giao diện: ít literal hơn, tự đúng ở tối.
- Nền toast tối (`#1f2033`) → `var(--ink)` với chữ `var(--background)` (đảo màu, đủ tương phản ở cả hai giao diện).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED community/hien-thi.md
#### Yêu cầu: Giao diện Tối của Community đọc được (một bộ token với shell)
Mọi màu trong CSS Community lấy từ token của shell (có bản sáng + tối); màu thương hiệu công ty lấy từ `--brand-*`. Không còn màu hex/rgb cứng ngoài `globals.css`; chữ trong bảng tin và trang Sổ Hợp Tác đạt tương phản AA (4.5:1, chữ lớn 3:1) ở cả Sáng và Tối.
- Kịch bản: khi CSS dưới `modules/**/styles` có màu hex/rgb/hsl cứng thì test đỏ [test: apps/workspace-web/src/styles/no-literal-colors.test.ts » không hex/rgb/hsl literal dưới modules/**/styles (dùng token globals.css)]
- Kịch bản: khi người dùng chọn giao diện Tối và mở bảng tin /community thì mọi chữ nhìn thấy đạt AA [test: e2e/community-web/contrast.cm.ts » tương phản chữ AA · Tối · /community (bảng tin): 0 vi phạm]
- Kịch bản: khi mở trang Sổ Hợp Tác ở giao diện Tối thì mọi chữ đạt AA [test: e2e/community-web/contrast.cm.ts » tương phản chữ AA · Tối · Sổ Hợp Tác: 0 vi phạm]
- Kịch bản: khi chuyển lại giao diện Sáng thì bảng tin vẫn đạt AA [test: e2e/community-web/contrast.cm.ts » tương phản chữ AA · Sáng · /community (bảng tin): 0 vi phạm]

## Việc còn lại
Chụp lại baseline visual (nếu spec visual đổi) khi chạy e2e cuối đợt.
