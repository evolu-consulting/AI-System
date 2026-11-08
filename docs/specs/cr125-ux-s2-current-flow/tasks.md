---
id: cr125-ux-s2-current-flow
lát: cr125-ux-s2-current-flow
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
S2 của `docs/specs/CR-125/ux-review-ceo.md` (C2, H1, M5): Cài đặt › Quy trình duyệt đọc ĐÚNG nguồn của tab Quy trình ở admin (`hub.company_flows` Bật,
sự kiện `contract.submitted`), một cửa duy nhất; bỏ khối khe "Quy trình HĐ mặc định"; công tắc ký số làm việc thật hoặc nói rõ vì sao không đổi được.

## Làm
- hub-api: `eventFlowOf` (`processes/library/event-flow.repo.ts`, MỘT câu SQL cố định, scope system) + cổng `PackRunsPort.eventFlow`; `readCurrentFlow` đọc cổng này
  (bước từ stage đã xuất bản qua `stepsOfStages`), không còn `resolveSlot`; `GET /pack/contracts/approval-flow` 404 khi công ty chưa có flow Bật.
- contracts: `ApprovalFlowCurrent` thêm `has_branches`, `other_flows`; `is_default` thành tuỳ chọn; `steps` được rỗng.
- workspace-web: gỡ mục "Ứng dụng & quy trình" (AppsPane, SlotCard, api-apps, use-apps-settings, app-slots) + hộp "Luật duyệt"/"Xem trước đường đi" (dữ liệu khe cũ);
  `FlowCurrentPane`: tên + bản của flow đang chạy, ghi chú rẽ nhánh / quy trình khác, nút "Mở trang Quy trình" (quản trị công ty), trạng thái "chưa có quy trình" nói rõ ai làm gì;
  `EsignSetting`: công tắc chỉ hiện khi đổi được (có thông báo "Đã lưu"); không đổi được ⇒ trạng thái + lý do (không còn ô khoá câm). `?sec=apps` cũ ⇒ mục Quy trình duyệt.
- D6 · mọi chỗ đọc nguồn cũ cho Cài đặt (đã chuyển/gỡ): `GET /pack/contracts/approval-flow` (hub, `readCurrentFlow` → `resolveSlot` nay là `eventFlow`); workspace-web `fetchFlow`/`useFlow`
  (FlowCurrentPane, FlowEditorLink của thẻ duyệt); `fetchRouting`/`fetchCapabilities` + `SlotCard` (`GET /tenants/:tid/process-routing/:slot`, `/hub-admin/tenants/:tid/capabilities`) — đã gỡ khỏi workspace-web;
  e2e: `contracts-web/approval-current`, `u2-contracts-ux`, `pm-checklist/cw-cr113`, `deployed/20-flows-visible`, `stg/uat-cr118`. `resolveSlot`/`routeSlot` vẫn phục vụ engine chạy HĐ + DLC (không đổi, ngoài phạm vi).

## Không làm / Chạm
Không chạm canvas admin (S3), trình hướng dẫn (S1), DLC. Điều kiện/hạn/chuyển cấp theo bước của flow sự kiện chưa hiện ở Cài đặt (chỉ tên bước + phòng ban + số người duyệt); chi tiết xem ở trang Quy trình.
Chuỗi legend canvas "Mờ = bị bỏ qua theo xem trước" còn nguyên (nhãn chung, không phụ thuộc nguồn).

## Test tối thiểu
unit `event-flow-steps.rules.test.ts`, `current-flow.test.ts`, `section-key.test.ts`; int `approval-flow-current.int.test.ts` (evotest -Dirty xanh); e2e hành trình `journey-approval/cr125-s2-settings-flow.spec.ts` (evotest -Dirty xanh, 3/3).
Ảnh trước/sau: `docs/specs/cr125-ux-s2-current-flow/shots/`.

## Quyết định trong lúc làm
- Flow hiển thị = flow Bật đầu tiên theo `position` cho `contract.submitted` (như bộ điều phối); các flow còn lại chỉ đếm (`other_flows`). Flow có node Nếu ⇒ ghi chú "có rẽ nhánh".
- M5: gộp hai mục (Ứng dụng & quy trình / Quy trình duyệt) thành một ở Cài đặt; menu tài khoản còn "Cài đặt Sổ Hợp Tác" + "Cài đặt Community" là hai ứng dụng khác nhau (không gộp ở lát này).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Quy trình duyệt chỉ chọn ở một nơi
Cài đặt chỉ có MỘT mục quy trình ("Quy trình duyệt") và đọc cùng nguồn với trang Quy trình của công ty (flow Bật cho hợp đồng); không còn mục "Ứng dụng & quy trình" hay quy trình mặc định của khe; câu chưa có quy trình không đẩy sang quản trị nền tảng.
- Kịch bản: khi công ty chưa có quy trình Bật thì Cài đặt nói quản trị công ty thêm ở trang Quy trình và chỉ có một mục quy trình [test: e2e/journey-approval/cr125-s2-settings-flow.spec.ts » 1 · chưa có quy trình Bật: Cài đặt nói rõ ai làm gì, không đẩy sang quản trị nền tảng, chỉ MỘT mục quy trình]
- Kịch bản: khi quản trị gán flow thì Cài đặt hiện cùng tên với tab Quy trình [test: e2e/journey-approval/cr125-s2-settings-flow.spec.ts » 2 · platform admin gán flow ⇒ Cài đặt hiện CÙNG tên với tab Quy trình, không còn 'Quy trình HĐ mặc định']
- Kịch bản: khi hỏi flow đang chạy thì lấy flow Bật của company_flows, flow Tắt không tính [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-current.int.test.ts » GET = flow Bật của company_flows: tên, bản, bước theo thứ tự, phòng ban theo tên công ty]
- Kịch bản: khi chỉ có flow Tắt thì trả 404, không có mặc định của khe [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-current.int.test.ts » công ty chỉ có flow Tắt ⇒ 404 (không có 'mặc định của khe'), PUT không còn route]
- Kịch bản: khi stage flow có bước duyệt/ký số/thông báo thì hiện đúng thứ tự, bỏ bước kỹ thuật [test: apps/hub-api/src/modules/packs/contracts/domain/event-flow-steps.rules.test.ts » Duyệt 2 cấp: hai bước duyệt + ký số + thông báo, bỏ Chờ ký xong / Kết thúc, theo thứ tự step]
- Kịch bản: khi mở khoá cũ ?sec=apps thì vào mục Quy trình duyệt [test: apps/workspace-web/src/features/settings/lib/section-key.test.ts » CR-125 · khoá cũ apps ⇒ mục Quy trình duyệt (đã gộp một cửa)]

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Công tắc ký số trong Cài đặt làm việc thật
Chủ gói bật/tắt ký số ở Cài đặt › Quy trình duyệt và thấy "Đã lưu"; người không đổi được (không phải chủ gói / chưa cấu hình) thấy trạng thái và lý do, không có ô khoá.
- Kịch bản: khi chủ gói bấm công tắc ký số thì lưu, báo đã lưu và tải lại vẫn giữ [test: e2e/journey-approval/cr125-s2-settings-flow.spec.ts » 3 · công tắc ký số trong Cài đặt bật được thật (lưu, tải lại vẫn bật)]

## Việc còn lại
Điều kiện/hạn/chuyển cấp từng bước của flow sự kiện ở Cài đặt (nếu sale cần); legend canvas "Mờ = bị bỏ qua theo xem trước" nên đổi chữ khi có dịp. Gộp menu "Cài đặt Community" + "Cài đặt Sổ Hợp Tác" thuộc lát khác.