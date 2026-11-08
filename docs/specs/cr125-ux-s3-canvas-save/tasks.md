---
id: cr125-ux-s3-canvas-save
lát: cr125-ux-s3-canvas-save
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
S3 của `docs/specs/CR-125/ux-review-ceo.md`: C3 (Lưu và áp dụng im lặng khi Ký số thiếu người ký), H2 (nhãn mặc định), M1 (nhãn thư viện, tên node).

## Làm
- C3 UI: `use-def-save.ts` — `FLOW_NODE_CONFIG_INVALID` (mã G1 `NO_SIGNER_SELECTED`...) giờ vừa gắn lỗi vào ô vừa hiện thông báo "Chưa lưu được — bước «X»: <lý do>" kèm nút "Đến bước" (chọn + cuộn tới bước).
- C3 Hub: `clone` (Sao chép để sửa) điền sẵn `company_signers = group:<nhóm duyệt đầu tiên>` (đã map alias c5b) khi ô trống — `esign-signer-prefill.rules.ts`.
- H2: ô "Mặc định" của Ký số nói rõ "Theo cài đặt ký số của công ty". M1: bỏ nhãn "React Flow" (`proOptions.hideAttribution`).
- Câu `NO_SIGNER_SELECTED` rút gọn (không lặp tên bước).

## Không làm / Chạm
Không chạm engine/run, workspace-web, onboarding, DLC. Chưa làm (để lát sau): chọn người ký theo tên+chức danh, cỡ chữ tối thiểu khi vừa khung, khung chi tiết cố định, bỏ cờ "chưa lưu" khi đổi Ngang/Dọc, đổi tên node "Nếu" (e2e fnr-showcase đang khoá theo chữ "Nếu").

## Test tối thiểu
Unit `esign-signer-prefill.rules.test.ts`; e2e `e2e/journey-approval/cr125-s3-save-blocked.spec.ts`.

## Quyết định trong lúc làm
Prefill chỉ ở đường sao chép (không đổi lúc lưu/chạy). Không có nhóm duyệt ⇒ để trống, vẫn bị chặn có thông báo.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED platform/trinh-sua-flow.md
#### Yêu cầu: Lưu và áp dụng không im lặng khi bước Ký số thiếu người ký
Khi lưu bị Hub từ chối vì cấu hình bước (vd Ký số chưa có người ký), trình sửa hiện thông báo nêu bước và lý do kèm nút "Đến bước"; bản sao từ Thư viện được điền sẵn người ký là nhóm duyệt của quy trình.
- Kịch bản: khi bỏ người ký rồi bấm Lưu và áp dụng thì thấy "Chưa lưu được" + "Đến bước", chọn người ký rồi lưu thì "Đã áp dụng" [test: e2e/journey-approval/cr125-s3-save-blocked.spec.ts » C3 · Lưu và áp dụng thiếu người ký nói rõ lý do rồi áp dụng được]
- Kịch bản: khi sao chép quy trình có nhóm duyệt thì bước Ký số có người ký là nhóm đó, không ghi đè người ký đã có [test: apps/hub-api/src/modules/processes/library/esign-signer-prefill.rules.test.ts » prefillEsignSigner]

## Việc còn lại
Chạy e2e (foreground, -Dirty), tsc, openspec:check, ảnh trước/sau.
