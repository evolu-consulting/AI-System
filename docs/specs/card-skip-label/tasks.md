---
id: card-skip-label
lát: card-skip-label
cr: CR-109
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Thẻ duyệt hiện "Chưa đến" cho bước có `when` mà HĐ không thỏa (vd Duyệt cấp 2 với giá trị < 500tr) tới khi bước trước xong rồi mới "Bỏ qua". Tính phía server trong read model thẻ (đã có mẫu chụp + facts): bước `pending`, idx ≥ 1, review, `when` không thỏa theo `stepApplies` (đúng luật `contracts-route`) ⇒ `skip_when` = các điều kiện không thỏa. Client hiện "Sẽ bỏ qua (giá trị < 500.000.000)" chữ mờ.

## Làm
- `packages/contracts` `ApprovalCardStep.skip_when?` (optional, additive).
- hub `approval-engine-card.rules.ts`: `willSkip` + `cardSteps(flow, sv, facts)`.
- contracts-web `engine-card.ts` (`skipWhen`, `skipReason`) + `ApprovalTimeline.tsx` + i18n vi/en (`willSkip`, `skipReason.*`).

## Không làm / Chạm
Không sửa migration/RLS, engine, `previewPath` (Settings đã đúng; logic thẻ dùng luật server `stepApplies`, không nhân đôi).

## Test tối thiểu
Unit: hub `approval-engine-card.rules.test.ts` (rule + mapping), web `engine-card.test.ts`.

## Quyết định trong lúc làm
- Làm server-side vì `engineCardView` đã có `flow` + `facts`; trạng thái `status` giữ `pending` (chỉ thêm gợi ý), giá trị trống ⇒ không báo bỏ qua (khớp `condHolds`).
- Bước đã `skipped` thật do engine ⇒ vẫn nhãn "Bỏ qua".

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Thẻ duyệt báo trước bước sẽ bị bỏ qua
Bước chưa tới (`pending`, không phải bước soạn) mà điều kiện `when` không thỏa với loại HĐ/giá trị hiện tại được trả kèm `skip_when` (các điều kiện không thỏa); thẻ hiện "Sẽ bỏ qua (giá trị < 500.000.000)" chữ mờ thay cho "Chưa đến". Giá trị trống ⇒ không báo bỏ qua.
- Kịch bản: HĐ 100tr, bước 2 có `when` giá trị ≥ 500tr, bước 1 đang mở ⇒ bước 2 có `skip_when` = điều kiện đó; HĐ 5.000tr ⇒ null [test: apps/hub-api/src/modules/packs/contracts/domain/approval-engine-card.rules.test.ts » CR-109 · skip_when]
- Kịch bản: dòng thời gian hiện nhãn bỏ qua chỉ cho bước pending có `skip_when`, đảo phép so ("≥ 500tr" ⇒ "< 500tr") [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.test.ts » CR-109 · nhãn sẽ bỏ qua]