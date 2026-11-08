---
id: cr125-g5-terms
lát: cr125-g5-terms
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chỉ đổi chữ (locale) + e2e khoá + glossary: G5 (#22 tenant → công ty), động từ "Duyệt" (G2), "Đang áp dụng" (G6), khoá slotMissing.

## Làm
- vi/en users/groups/access: bỏ "tenant/tenant_admin" → "công ty/quản trị công ty"; glossary.vi.json thêm luật.
- "Kiểm ngay/Cần bạn kiểm/chưa ai kiểm/Chuyển cho ai kiểm" → "Duyệt …".
- v2l: "Đang dùng mặc định" → "Đang áp dụng"; tiêu đề "…đang áp dụng"; thêm contracts.settings.apps.slotMissing.

## Không làm / Chạm
Không đổi code hub, toast, màu, DLC.

## Test tối thiểu
i18n:check, check:i18n-terms, test:lock:verify, openspec:check; evotest e2e: P-a P-d contracts-web root@1=e2e/users.spec.ts.

## Quyết định trong lúc làm
Luật glossary tenant chỉ bắt tenant_admin/câu cụ thể ở vi.json (màn quản trị nền tảng vẫn dùng "tenant").

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

Không thay đổi hành vi (lý do: chỉ đổi nhãn/chữ hiển thị và khoá i18n còn thiếu; không đổi logic hay dữ liệu).

## Việc còn lại