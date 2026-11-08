# company flows

Cập nhật: 2026-11-08 · Nguồn: cr122-e1b-company-flows. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Danh sách flow của công ty (FLOW2-FR-05..09/20)
Platform admin gán flow Thư viện (đã xuất bản, có Bắt đầu khi) cho công ty; tenant admin xem, bật/tắt, xếp thứ tự, sao chép để sửa, xuất bản bản sao (gốc tự Tắt), quay về bản gốc — mỗi thao tác một tx. Không trỏ được def của công ty khác. Không tắt được flow không điều kiện cuối cùng của sự kiện bắt buộc.
- Kịch bản: khi gán và xem từ công ty khác thì bị chặn, def công ty khác không gán được [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » gán: platform_admin được, tenant_admin 403, vai: member 403, công ty khác 404, def công ty khác 422 và không lộ]
- Kịch bản: khi tắt flow không điều kiện cuối của sự kiện bắt buộc thì 409 [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » tắt flow không điều kiện cuối của sự kiện required ⇒ 409, có flow khác không điều kiện thì tắt được]
- Kịch bản: khi sao chép thì có bản công ty đổi Group theo mã, bấm lại trả bản cũ [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » sao chép để sửa: bản công ty Tắt chưa xuất bản, Group mã → id, lần hai trả bản cũ, công ty thiếu phòng ⇒ 422 nêu mã]
- Kịch bản: khi xuất bản bản sao thì gốc Tắt, quay về thì đảo lại [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » xuất bản bản sao ⇒ bản sao Bật + gốc Tắt (replaced_by), quay về bản gốc ⇒ đảo lại, bản sao giữ (reverted)]

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Mẫu Thư viện chỉ trao cho công ty khi áp dụng được (nguồn: cr125-c5-template-readiness)
Gán (platform) và sao chép (công ty) kiểm "mẫu dùng được": thiếu tính năng/chức năng ⇒ 422 nêu thiếu gì và ai cần bật; nhóm duyệt khớp nhóm có thật của công ty, không khớp ⇒ bước chọn người duyệt.
- Kịch bản: khi mẫu cần tính năng công ty chưa bật thì gán và sao chép bị chặn kèm lý do [test: apps/hub-api/src/modules/processes/library/company-flows-readiness.int.test.ts » gán mẫu chưa dùng được]
- Kịch bản: khi mẫu chỉ cần nhóm quản trị gói thì bản sao dùng nhóm chủ gói của công ty [test: apps/hub-api/src/modules/processes/library/company-flows-readiness.int.test.ts » mẫu dùng được]

#### Yêu cầu: Platform thấy và sửa một chạm điều kiện của mẫu trước khi gán (nguồn: cr125-c5b-readiness-ui)
Chọn mẫu để gán hiện thiếu gì (tính năng, chức năng, nhóm); nút "Bật tính năng cho công ty" và "Tạo nhóm theo gợi ý" chỉ platform_admin, ghi audit; Gán khoá tới khi dùng được. Công ty thấy cùng thông tin trước khi sao chép.
- Kịch bản: khi platform bấm sửa một chạm cho đúng công ty thì công ty khác không đổi và có dòng audit [test: apps/admin-api/src/modules/template-fixes/template-fixes.int.test.ts » enable-feature]
- Kịch bản: khi tenant_admin gọi route sửa thì bị từ chối và không ghi gì [test: apps/admin-api/src/modules/template-fixes/template-fixes.int.test.ts » vai khác platform_admin]
- Kịch bản: khi mẫu chưa dùng được thì Gán khoá, bấm sửa xong gán được, công ty sao chép và áp dụng được [test: e2e/community-web/template-readiness.cs.ts » platform: mẫu chưa dùng được]

#### Yêu cầu: Trình sửa quy trình — đổi cách xem và toast lỗi không cản nút Lưu (nguồn: cr125-fix-e2e-editor)
Bấm "Sơ đồ" / "Danh sách bước" chỉ đổi cách xem, không lưu quy trình (nút công tắc không còn là nút gửi form). Toast lỗi của Lưu (bị chặn trước khi gửi hoặc Hub từ chối) ở lại tới khi đóng nhưng hiện giữa-trên, không đè nút Lưu.
- Kịch bản: khi người dùng chuyển sang Danh sách bước thì không có PUT /process-defs và bản đã lưu không đổi [test: e2e/P-b2/admin/canvas.pb2.ts » ADM-FR-71 · E-PB2-09 · nút panel 'Chuyển sang bước sau' / 'Chuyển sang bước trước' / 'Lên' (đường a11y thay kéo thả)]
- Kịch bản: khi Lưu bị chặn vì lỗi nhập (đường dẫn sai, quá 10 mục) thì người dùng sửa xong vẫn bấm Lưu lại được [test: e2e/P-b/admin/editor.pb.ts » ADM-FR-69 · HUB-FR-121 · PB-R06 · PB-R14 · E-PB09 · chặn: bước >5 nguồn (ô thứ 6 disabled), nguồn ngoài quy trình (không có ô), glob "../x", >10 mục must_know, bỏ nguồn đang được bước dùng]

#### Yêu cầu: Lý do mẫu chưa dùng được là mã + biến, web dịch (nguồn: cr125-fix-errors)
Hub trả lý do chặn dưới dạng mã và biến (bước, khoá tính năng/tool), kèm danh sách bước cố định; web dịch bằng i18n. Khi không tải được kiểm tra, màn hình nói lý do và có nút Thử lại; lỗi nút sửa nói đúng bước kế theo mã lỗi.
- Kịch bản: khi mẫu có bước cố định thì readiness trả mã READINESS_STEP_LOCKED và tên bước trong dữ liệu [test: packages/contracts/src/modules/template-readiness.test.ts » bước khe cố định (slot)]
- Kịch bản: khi gán mẫu chưa dùng được thì 422 trả mã và biến, không có câu chữ [test: apps/hub-api/src/modules/processes/library/company-flows-readiness.int.test.ts » sao chép mẫu chưa dùng được]
- Kịch bản: khi không tải được readiness thì hiện lý do theo mã lỗi [test: apps/admin-web/src/features/tenants/flows/lib/readiness-view.test.ts » lỗi tải / lỗi nút sửa]

#### Yêu cầu: Gợi ý check flow_flag không bảo gỡ gán (nguồn: cr125-fix-errors)
Gợi ý nói công ty đang tạm dừng quy trình và cách bật lại ở Cài đặt nếu không cố ý.
- Kịch bản: khi có công ty lệch cờ thì hint chứa "bật lại ở Cài đặt nếu không cố ý" [test: apps/hub-api/src/modules/ops/adapters/checks/flow-flag.check.test.ts » có công ty lệch ⇒ warn]

#### Yêu cầu: Công ty đã được gán quy trình luôn dùng quy trình mới (nguồn: cr125-g8-flow-flag)
Migration hub 0126 bật cờ cho mọi công ty có `company_flows` đang bật (idempotent, không đụng công ty khác); gán / áp dụng quy trình tự bật cờ cùng giao dịch.
- Kịch bản: khi chạy migration thì công ty có dòng gán bật có cờ BẬT, công ty không có dòng gán giữ nguyên, chạy lại không đổi [test: apps/hub-api/src/modules/processes/library/flow-flag-backfill.int.test.ts » công ty có dòng gán bật ⇒ BẬT, công ty khác không đổi, chạy lại vô hại]
- Kịch bản: khi platform gán quy trình cho công ty thì cờ BẬT cùng giao dịch [test: apps/hub-api/src/modules/processes/library/company-flows-active.int.test.ts » platform gán quy trình cho công ty mới ⇒ BẬT, công ty không đụng tới ⇒ vẫn TẮT]

#### Yêu cầu: Nhóm «ai được bắt đầu» là nhóm cần của mẫu (nguồn: cr125-manual-start-engine)
`templateNeeds` tính `start_form.starters.group_keys` của stage là nhóm cần (như nhóm duyệt), để gán/sao chép mẫu báo thiếu nhóm.
- Kịch bản: khi mẫu có phiếu yêu cầu chỉ cho nhóm «mua-hang» thì nhóm cần của mẫu có «mua-hang» [test: packages/contracts/src/modules/core/start-form/config.test.ts » nhóm «ai được bắt đầu» là nhóm cần của mẫu, node có trong sổ module]

