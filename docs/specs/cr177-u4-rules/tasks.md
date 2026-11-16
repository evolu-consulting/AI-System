---
id: cr177-u4-rules
lát: cr177-u4-rules
cr: CR-177
làn: nhanh
migration: không
phụ thuộc: cr177-u1..u3
---
## Plan (ngắn)
Bảng khái niệm → icon, luật dùng (RULES.md), và máy chặn kiểu «chỉ giảm» (`check:ui-kit`) để app không tái phát phần tử trần.

## Làm
- [x] `packages/web-kit/src/ui/kit/icons.ts` (+ test).
- [x] `packages/web-kit/src/ui/kit/RULES.md`; trỏ từ `docs/CONVENTIONS.md`.
- [x] `tools/scripts/src/check-ui-kit.ts` + `.rules.ts` (+ test), lệnh `check:ui-kit`, mốc `tools/scripts/ui-kit-baseline.json`, nối vào `bun run check`.

## Không làm / Chạm
Không sửa code app, không đổi component kit. Chạm: package.json (lệnh), CONVENTIONS.md (1 dòng).

## Test tối thiểu
`bun test tools/scripts/src/check-ui-kit` · `bun test packages/web-kit/src/ui/kit` · `bun run check:ui-kit`.

## Quyết định trong lúc làm
- Chỉ quét app `*-web`; `title=` chỉ đếm trên thẻ HTML chữ thường (prop `title` của component viết hoa không tính).
- Mốc lưu tổng theo app; khi đỏ, in mọi chỗ hiện có của chỉ số đó (không có mốc theo file) để người sửa tự đối chiếu.
- `--update` chỉ ghi khi không chỉ số nào vượt mốc (trừ lần tạo mốc đầu tiên).
- Nối `check:ui-kit` vào `bun run check` (cùng khuôn `check:toast`).
- Mốc đặt từ nhánh này; các lát khác đang giảm số đếm ⇒ sau khi gộp chạy `check:ui-kit --update` để hạ mốc.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/giao-dien-chung-luat.md
#### Yêu cầu: Bảng khái niệm → icon dùng chung
Mỗi khái niệm nghiệp vụ có đúng một icon lucide trong `icons.ts`; hai khái niệm không dùng chung icon.
- Kịch bản: mọi giá trị là component lucide hợp lệ [test: packages/web-kit/src/ui/kit/icons.test.ts » mọi giá trị là component lucide (forwardRef có displayName)]
- Kịch bản: không trùng icon giữa các khái niệm [test: packages/web-kit/src/ui/kit/icons.test.ts » không trùng icon giữa các khái niệm]

#### Yêu cầu: Phần tử trần của app chỉ được giảm
Số `<button>`/`<select>`/`<input>` trần, `title=` trên thẻ HTML, file `components/ui` riêng, `text-[…px]`/`rounded-[…]` mỗi app không vượt mốc; vượt ⇒ `check:ui-kit` đỏ và in file + dòng; `--update` chỉ hạ mốc.
- Kịch bản: đếm button/select trần, không đếm component viết hoa [test: tools/scripts/src/check-ui-kit.test.ts » đếm button/select trần, không đếm component viết hoa]
- Kịch bản: input trần trừ hidden/file/checkbox/radio [test: tools/scripts/src/check-ui-kit.test.ts » input trần trừ hidden/file/checkbox/radio]
- Kịch bản: title= chỉ trên thẻ HTML thường [test: tools/scripts/src/check-ui-kit.test.ts » title= chỉ trên thẻ HTML thường]
- Kịch bản: cỡ chữ/bo góc tuỳ ý bị đếm [test: tools/scripts/src/check-ui-kit.test.ts » cỡ chữ/bo góc tuỳ ý, không đếm lớp chuẩn hay màu]
- Kịch bản: vượt mốc ⇒ đỏ, thấp hơn ⇒ nhắc hạ [test: tools/scripts/src/check-ui-kit.test.ts » vượt mốc / thấp hơn mốc]

## Việc còn lại
Sau khi các lát U-workspace gộp: `bun run check:ui-kit --update` để hạ mốc.
