---
id: fix-cr182-ui
lát: fix-cr182-ui
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa các lỗi web do soát UI lượt 4 (CR-182 + CR-184), `docs/specs/CR-181/uat-ui-review.md` mục «Lượt 4». Chỉ web + i18n, không đổi contract.

## Làm
- [x] L1 `/contracts/verify` bị `legacyTarget` đổi thành `/contracts/c/verify`: thêm `verify` vào `CONTRACTS_PAGES`; test quét cây route `routes/_authed/contracts/**`.
- [x] L2 «Lưu chỗ ký» sập `i is not a function`: `useEffect(() => el.scrollTo(...))` trả Promise làm hàm dọn ⇒ bọc `{}`; khung màn ký có error boundary (câu tiếng Việt + «Tải lại»); test quét mọi effect dạng mũi tên trần.
- [x] L3 avatar người ký lặp cả hai tên: tooltip theo từng người (`personTip`); chạm avatar trên điện thoại hiện tên (`TouchTip tap`).
- [x] L4 chữ thẻ bước ở sơ đồ Cài đặt 6–7px: khung canvas đủ lớn để fit ở zoom 1 (chữ 12px), sơ đồ dài cuộn trong khung (`flowBox`).
- [x] L5 tiêu đề «Ký số qua nhà cung cấp» bỏ DocuSign (VI + EN).
- [x] L6 «Mục này chỉ để xem…» sai khi quản trị giao việc ⇒ đổi câu. `LockedMark` khung ngoài 0×0 ⇒ `inset-0` (Playwright `toBeVisible`).

## Không làm / Chạm
- Chạm: `apps/workspace-web/src/{shared/kernel,shared/ui,features/doc-sign,features/settings,routes/_authed/contracts}`, `packages/i18n/locales/contracts/{docsign,v2l}.*`.
- Không làm: «Ký thử» (nhãn nghiệp vụ, giữ); toast «Đã lưu uỷ quyền» (đã có `deleg.saved`, đã tắt trước khi chụp); lỗi Thấp còn lại ghi `docs/TECH-DEBT.md`.

## Test tối thiểu
`legacy-routes.test.ts`, `effect-return.test.ts`, `sign-error-boundary.test.tsx`, `contract-view.test.ts`, `SignersStrip.test.tsx`, `avatar-tip.test.ts`, `flow-box.test.ts`, `view-bar.test.tsx`.

## Quyết định trong lúc làm
- Lỗi 4 làm ở host (`FlowCanvas.tsx` của settings), không sửa gói `@ai/flow-canvas` (ngoài phạm vi): khung bên trong = cỡ sơ đồ / 0.84 ⇒ luật fit của gói cho zoom 1.
- Chạm avatar: tooltip có điều khiển, bỏ qua lệnh đóng trong 500ms sau chạm (click đi kèm).
- e2e `cr182-assign.cw.ts`: mock dùng `role.key = "giam_doc"` trái hợp đồng (`ROLE_KEY_RE` không cho `_`) ⇒ sửa mock thành `giam-doc` (việc của qc).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Sơ đồ quy trình duyệt đang dùng của tenant dùng gói sơ đồ chung (CR-106/108/113, UW-FR-14) (nguồn: cr118-flow-canvas)
- Kịch bản: khi mở sơ đồ quy trình ở Cài đặt thì chữ thẻ bước giữ cỡ thật (zoom 1) và sơ đồ dài cuộn trong khung [test: apps/workspace-web/src/features/settings/lib/flow-box.test.ts » sơ đồ dài]
- Kịch bản: khi mở `/contracts/verify` thì không bị chuyển thành `/contracts/c/verify` [test: apps/workspace-web/src/shared/kernel/legacy-routes.test.ts » quét cây route]
- Kịch bản: khi lưu chỗ ký mà màn gặp lỗi hiển thị thì hiện câu tiếng Việt kèm «Tải lại» [test: apps/workspace-web/src/features/doc-sign/components/sign-error-boundary.test.tsx » màn thay thế]
- Kịch bản: khi một nhóm có nhiều người ký thì mỗi avatar có tooltip đúng tên người đó [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » mỗi avatar một tooltip]

## Việc còn lại
- qc: sửa mock `cr182-assign.cw.ts` (`giam_doc` → `giam-doc`); chạy lại `e2e/cr181/fan-seam-sign.spec.ts` (LockedMark nay có cỡ).
- Chưa kiểm trên thiết bị thật: chạm avatar hiện tên (không có DOM ở bun test).
