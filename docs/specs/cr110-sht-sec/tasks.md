---
id: cr110-sht-sec
lát: cr110-sht-sec
cr: CR-110
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
`/settings?sec=<khoá>` trong contracts-web mở hộp thoại Cài đặt thẳng ở mục đó (tiền đề COM-FR-41/42: mục SHT của Cài đặt chung Community là deep-link, không nhúng).

## Làm
- `features/settings/lib/section-key.ts` (hàm thuần khoá → mục) + unit test.
- `routes/_authed/settings/index.tsx`: `validateSearch` + `beforeLoad` mở hộp thoại bằng bus rồi về `/overview`; không `sec` ⇒ vẫn chuyển `/settings/members`.
- e2e: thêm một test vào `e2e/contracts-web/v2l-settings.cw.ts` (viết, chưa chạy; qc cần relock).

## Không làm / Chạm
Không đổi hộp thoại, quyền, API. Khoá hợp lệ: co, rep, biz, scout, flow; khoá lạ ⇒ co. Sau SSO `next=/settings?sec=…` giữ nguyên query (safeNext không cắt).

## Test tối thiểu
Unit `section-key.test.ts`; e2e viết sẵn.

## Quyết định trong lúc làm
- Có `sec` ⇒ về `/overview` (Shell giữ hộp thoại). Không phải chủ sở hữu ⇒ hộp thoại chỉ xem như hiện nay.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Mở Cài đặt thẳng một mục bằng đường dẫn
`/settings?sec=<co|rep|biz|scout|flow>` mở hộp thoại Cài đặt ở mục đó rồi về Tổng quan; khoá lạ mở mục mặc định (Công ty); không có `sec` giữ nguyên chuyển sang Thành viên. Quyền xem/sửa theo hộp thoại hiện có.
- Kịch bản: khi vào `/settings?sec=biz` thì hộp thoại mở ở mục Điểm kinh doanh [test: e2e/contracts-web/v2l-settings.cw.ts » CR-110: /settings?sec=biz mở thẳng hộp thoại ở mục Điểm kinh doanh, khoá lạ ⇒ mục Công ty]
- Kịch bản: khi `sec` là khoá lạ thì mở mục Công ty [test: apps/workspace-web/src/features/settings/lib/section-key.test.ts » khoá lạ ⇒ mục mặc định co]

## Việc còn lại
qc relock e2e đã làm (`test:lock:write`).