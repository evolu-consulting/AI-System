---
id: cr187-font-inter
lát: cr187-font-inter
cr: CR-187
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Đổi phông giao diện 4 app web sang Inter (BR-187-10).

## Làm
- [x] Thêm `@fontsource/inter` 5.3.0, gỡ `@fontsource/be-vietnam-pro` khỏi 4 app; import subset latin + vietnamese, độ đậm 400/500/600/700.
- [x] `--font-sans: "Inter", "Segoe UI", system-ui, sans-serif`.

## Không làm / Chạm
Phông nhúng PDF phía hub-api (Be Vietnam Pro, ADR-0042) giữ nguyên — không phải phông giao diện.

## Test tối thiểu
`bun install` sạch; `bun run build` workspace-web xanh. Không có test token nào nêu tên phông.

## Quyết định trong lúc làm
- workspace-web `--font-mono`: dùng Inter như trước (trước là Be Vietnam Pro), không thêm phông mono.
- admin/chat/studio giữ JetBrains Mono cho `--font-mono`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đổi phông giao diện, không đổi nghiệp vụ).

## Việc còn lại
Chụp lại baseline Playwright cuối đợt (ảnh so sẽ lệch do đổi phông).
