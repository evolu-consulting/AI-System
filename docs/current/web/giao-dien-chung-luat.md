# Luật dùng bộ giao diện chung và `check:ui-kit` (CR-177 · nguồn: cr177-u4-rules)

Luật viết cho người code: `packages/web-kit/src/ui/kit/RULES.md` (gồm cả luật mobile). Bảng icon: `packages/web-kit/src/ui/kit/icons.ts`. Công cụ: `tools/scripts/src/check-ui-kit.ts` (`bun run check:ui-kit [--update]`).

#### Yêu cầu: Bảng khái niệm → icon dùng chung
Mỗi khái niệm nghiệp vụ có đúng một icon lucide trong `icons.ts`; hai khái niệm không dùng chung icon. Khoá/phiên bản/cảnh báo dùng `ICONS` (không emoji), icon khoá có nhãn «Đã khoá» cho trình đọc màn hình (nguồn: cr177-w4-fixes).
- Kịch bản: mọi giá trị là component lucide hợp lệ [test: packages/web-kit/src/ui/kit/icons.test.ts » mọi giá trị là component lucide (forwardRef có displayName)]
- Kịch bản: không trùng icon giữa các khái niệm [test: packages/web-kit/src/ui/kit/icons.test.ts » không trùng icon giữa các khái niệm]
- Kịch bản: dòng phiên bản hiện hành dùng khái niệm «locked» của bộ icon [test: apps/workspace-web/src/features/contract-versions/lib/versions.test.ts » mỗi loại trỏ khái niệm icon của bộ chung]

#### Yêu cầu: Phần tử trần của app chỉ được giảm
Số `<button>`/`<select>`/`<input>` trần, `title=` trên thẻ HTML, file `components/ui` riêng, `text-[…px]`/`rounded-[…]` của mỗi app không vượt mốc đã ghi; vượt ⇒ `check:ui-kit` đỏ, in file + dòng; `--update` chỉ hạ mốc. Mốc đã ghi được hạ sau khi các lát chuyển app gộp (mốc hiện hành trong file mốc của script; admin: input 9, arbitrary 6 tại thời điểm chuyển).
- Kịch bản: đếm button/select trần, không đếm component viết hoa [test: tools/scripts/src/check-ui-kit.test.ts » đếm button/select trần, không đếm component viết hoa]
- Kịch bản: input trần trừ hidden/file/checkbox/radio [test: tools/scripts/src/check-ui-kit.test.ts » input trần trừ hidden/file/checkbox/radio]
- Kịch bản: title= chỉ trên thẻ HTML thường [test: tools/scripts/src/check-ui-kit.test.ts » title= chỉ trên thẻ HTML thường]
- Kịch bản: cỡ chữ/bo góc tuỳ ý bị đếm [test: tools/scripts/src/check-ui-kit.test.ts » cỡ chữ/bo góc tuỳ ý, không đếm lớp chuẩn hay màu]
- Kịch bản: vượt mốc ⇒ đỏ, thấp hơn ⇒ nhắc hạ [test: tools/scripts/src/check-ui-kit.test.ts » vượt mốc / thấp hơn mốc]
