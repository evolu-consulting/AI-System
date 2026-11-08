---
id: pm-checklist-e2e
lát: pm-checklist-e2e
cr: CR-112, CR-113
làn: nhanh
migration: không
phụ thuộc: pm-ready
---
## Plan (ngắn)
Chứng minh checklist PM trong `docs/PM-SETUP.md` §5 (CR-112 5 bước, CR-113 6 bước) chạy đúng trên UI thật với đúng dữ liệu seed của PM
(tenant `evolu`, 5 user, quy trình duyệt mẫu, 3 HĐ `[CR-113]`) bằng e2e Playwright đi từng bước, không mock.

## Làm
- `e2e/pm-checklist/playwright.pm.config.ts` + `_pm-stack.ts`: stack thật như `pm:setup` trên DB test (migrate, fixture evolu, gói, quy trình mẫu,
  3 HĐ mẫu qua `seedCr113Samples`), hub-api chạy trong tiến trình stack để có `remindOnce` (quá hạn: `escalate_at` quá khứ + MỘT lượt nhắc, không chờ 300 s).
- Specs: `admin-cr112.pm.ts` (CR-112 bước 1–5), `cw-cr113.pm.ts` (CR-113 bước 1–5), `admin-cr113-flow.pm.ts` (CR-113 bước 6).
- Đăng ký việc e2e `pm-checklist-pm` ở `tools/scripts/src/test-e2e-par.rules.ts`; relock `tests/.lock`.
- `docs/PM-SETUP.md`: sửa chỗ chữ/kỳ vọng lệch UI thật (xem danh sách ở báo cáo).

## Không làm / Chạm
Không đổi sản phẩm.

## Test tối thiểu
`powershell deploy/evotest/run-tests.ps1 -Step e2e -Filter "pm-checklist-pm" -All`.

## Quyết định trong lúc làm
- Mỗi người dùng đăng nhập ở context mới qua trang đăng nhập (thay "đăng xuất, đăng nhập lại").

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: e2e + tài liệu)

## Việc còn lại
