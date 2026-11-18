# CR-182 · Ký trên tài liệu — đợt 2 · quyết định chung cho mọi lát

Nguồn nghiệp vụ: `docs/specs/CR-181/nghiep-vu.txt` (mục «Gọn cấu hình ký», «Chuyển quy trình hợp đồng hiện tại sang cách mới», «Quy trình mẫu và
giao việc», «Kiểu xem khi ký», «Ký vào chỗ đã chuẩn bị» phần đối tác, BR-C5, BR-G2, phụ lục ký sau, kiểm tra tệp). Đợt 1: `docs/specs/CR-181/decisions.md`
(Q1–Q18 vẫn áp dụng). Người dùng cho làm đợt 2 ngày 2026-11-18 («bạn làm luôn đợt 2»). Bản đồ file: báo cáo rà code (tóm ở §4).

## 1. Quyết định (R = mặc định đã nêu với người dùng)
- R1 Vai: quy trình VẪN thuộc từng công ty, do quản trị nền tảng soạn (giữ CR-127). KHÔNG dựng lại quy trình mẫu dùng chung nhiều công ty,
  KHÔNG «Sao chép để sửa». Bước Duyệt (kể cả nhóm song song, chuyển cấp) và bước Ký ghi `role` (khoá vai + nhãn, ví dụ `nguoi-duyet-cap-1`,
  `nguoi-ky-hop-dong`). Quản trị công ty (Q15) giao NHÓM hoặc MỘT NGƯỜI cho từng vai ở Cài đặt › Quy trình duyệt (bấm bước trên sơ đồ).
  Một vai dùng ở nhiều bước ⇒ giao một lần. Bước có vai chưa giao ⇒ viền vàng «Chưa giao người»; HĐ đi tới đó dừng chờ + chuông cho quản trị.
- R2 Giải vai: tại MỘT điểm — lúc bắt đầu lượt chạy (`processes/runs/start.service.ts:204`), điền `group_id`/`approver_user_id`/
  `args.company_signers` vào ảnh chụp def ⇒ mọi chỗ đọc phía sau không đổi. Đường nháp (`submit.usecase.ts:161 plannedStages`) và màn xem
  (`approval-flow.usecase.ts`) cũng giải vai. BR-G2: đổi giao việc ⇒ bước chưa tới lượt dùng người mới; bước đang chờ giữ người cũ.
- R3 Gọn cấu hình ký: bước Ký dùng `signer_role` + công tắc `need_digital` (mặc định tắt). «Ký qua» (provider) và «Người ký phía công ty»
  (company_signers) bị ẨN khỏi trình soạn; dữ liệu cũ GIỮ. Khi công ty bật `on_doc_enabled` ⇒ bước Ký chạy ký trên tài liệu với người ký từ vai;
  công ty tắt ⇒ chạy y như cũ (provider/company_signers). DocuSign: ẩn khỏi mọi danh sách chọn, adapter + webhook vẫn chạy để phong bì cũ đồng bộ/xem.
  `need_digital = true` khi chưa có chữ ký số ⇒ báo ngay khi lưu quy trình (đợt 3 mới ký số).
- R4 Chuyển quy trình hiện tại + công tắc lùi: migration CHỈ THÊM điền `role` vào stage từ cấu hình đang dùng (mã/id nhóm ⇒ vai + hàng giao
  việc = nhóm đó; `company_signers` ⇒ vai «Người ký hợp đồng» + giao việc tương ứng). Cấu hình cũ giữ trong jsonb. Công tắc lùi = `on_doc_enabled`
  theo công ty (đợt 1). HĐ đang duyệt dở chạy tiếp ảnh chụp cũ; gửi lại sau Trả lại thì dùng quy trình mới. Không đụng `process_runs`.
- R5 Đối tác ký qua link (BR-C5): bước «Đối tác ký» = tự chạy sau khi bên A ký đủ nếu HĐ có chỗ ký Bên B. Gửi email «Mời ký» (kênh notify có sẵn,
  `HUB_NOTIFY_MODE`) tới liên hệ đối tác (đầu tiên có email) với link riêng; token chỉ lưu hash (khuôn `partners/adapters/partner-public.routes.ts`,
  `domain/email-link.rules.ts`), CSRF kép + giới hạn tần suất như CR-150; hạn = hạn bước (mặc định 7 ngày), «Gửi lại link» được. Trang công khai
  không cần tài khoản (route ngoài `_authed` ở workspace-web): chỉ thấy tệp được gửi + chỗ ký của mình; lần đầu tạo chữ ký nhanh (gõ tên/vẽ) gắn
  với link; ký vào ô + tự đặt thêm (cả giáp lai); Lưu ⇒ máy chủ in (như BR-K3: chữ ký nhanh lưu ở máy chủ trước, lúc Lưu chỉ gửi vị trí). Ký xong ⇒
  HĐ «Đã ký», email kèm bản đã ký cho đối tác, chuông cho bên A. Dùng lại link sau khi ký ⇒ chỉ xem. Đối tác từ chối ⇒ ghi lý do, báo người tải lên.
- R6 Phụ lục ký sau: trên HĐ đã ký có «Thêm phụ lục cần ký» ⇒ tạo phụ lục (`kind=appendix`, `parent_id`, đã có) + tệp chính cần ký ⇒ chạy duyệt
  + ký riêng theo bộ chọn quy trình như HĐ (chưa có luật riêng cho phụ lục). HĐ gốc giữ nguyên.
- R7 Kiểm tra tệp: màn trong app «Kiểm tra tệp» (Sổ Hợp Tác): tải tệp lên ⇒ máy chủ tính sha256, so với `sign_versions.sha256` + tệp gốc của công ty ⇒
  «Khớp bản <Sau khi … ký> của HĐ <tên>» hoặc «Không khớp bản nào đã lưu». Không lưu tệp tải lên.
- R8 Xoè quạt / Liền mép: như bản mẫu; điện thoại chỉ Từng trang (lát cr182-fan).

## 2. Số migration (giao trước)
hub 0158 = dành cho `cr184-deleg2` nếu cần · hub **0159** = `cr182-roles` (bảng giao vai) · hub **0160** = `cr182-migrate` (điền vai vào def) ·
pack-contracts **0123** = `cr182-partner-link` (link ký đối tác + chữ ký nhanh). Lát cần thêm ⇒ hỏi điều phối số kế tiếp.

## 3. Lát
| Lát | Việc | Phụ thuộc |
|---|---|---|
| cr182-fan | Xoè quạt + Liền mép (web) | — (đang chạy) |
| cr182-roles | schema `role` (review/parallel/escalate) + `signer_role`/`need_digital` cho Ký; bảng `hub.process_role_assignments` (0159, RLS: đọc T, ghi quản trị); repo; `withRoles` ở điểm giải R2; API `GET/PUT /pack/contracts/approval-flow/roles` + `graph` có `role`/`assigned` | — |
| cr182-admin | trình soạn admin: ô Vai cho Duyệt/Ký, ẩn «Ký qua»/«Người ký phía công ty», công tắc «Cần chữ ký số», ẩn DocuSign; kiểm khi lưu | roles |
| cr182-assign | Cài đặt › Quy trình duyệt chế độ giao việc (bấm bước ⇒ khung bên: vai, các bước dùng vai, nhóm/người + thành viên, «Lưu giao việc» có xác nhận; viền vàng chưa giao; thành viên chỉ xem) | roles |
| cr182-migrate | migration 0160 điền vai + giao việc từ cấu hình cũ; bước Ký chạy theo vai khi công ty bật; chuông «chưa giao người» | roles |
| cr182-partner-api | 0123 + route công khai + email mời ký + bước Đối tác ký + hoàn tất/ từ chối | — |
| cr182-partner-web | trang công khai ký của đối tác + gửi lại link ở trang HĐ | partner-api |
| cr182-annex-verify | phụ lục ký sau (R6) + kiểm tra tệp (R7) | — |
| cr182-seed | seed demo: vai + giao việc, liên hệ đối tác, link ký lấy từ log khi `HUB_NOTIFY_MODE=off` | migrate, partner |
| cr182-qc | e2e hành trình đợt 2 + sửa test khoá | tất cả |

## 4. Bản đồ file (tóm)
Stage zod `packages/contracts/src/hub-admin/processes.ts:141-244` (`after.review` :188-217) · `process-approve.ts:58-74` · `process-group-refs.ts` ·
Ký `packages/contracts/src/pack-contracts/esign-node.ts` · DB `packages/db/src/schema/hub-processes.ts` · giải nhóm khi chạy `triggers/flow-launch.ts:37-57`,
`defs/def-group-bind.ts` · điểm giải vai `processes/runs/start.service.ts:204` (+ `flow-launch.ts:54`, `subprocess-def.ts:34`, `flow-preview.service.ts:95`,
`flow-outline.service.ts:56`, `submit.usecase.ts:161`) · admin `apps/admin-web/src/features/processes/components/editor/StageApproveBasics.tsx`,
`modules/contracts/esign/Panel.tsx` · kiểm `defs/def.rules.ts:97`, `esign-node.validator.ts` · SHT sơ đồ `packages/flow-canvas/src/layout/def-graph.ts`,
`FlowCurrentPane.tsx`, `FlowCanvas.tsx` (`onNodeClick` có sẵn; `mode.ts:10`) · link công khai `partners/adapters/partner-public.routes.ts`,
`public-page.view.ts`, `email-dispatch.ts` · phụ lục `adapters/appendix.routes.ts:68` · DocuSign `domain/esign.providers.ts:19-36`.

## Quyết định trong lúc làm
(lát ghi một dòng vào tasks.md của mình; điều phối gom về đây cuối đợt)
