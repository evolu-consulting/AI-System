# Admin · Ứng dụng của feature là một cột duy nhất

Cập nhật: 2026-11-09 · Gộp từ: cr121-c18-feature-app-col (đợt cr125-wave).

## Yêu cầu: Ứng dụng của feature là một cột duy nhất (nguồn: cr121-c18-feature-app-col)
Mỗi feature có cột `app` (core, chat, community, contracts, knowledge hoặc other); mọi nơi cần biết feature thuộc ứng dụng nào (lọc công ty theo Ứng dụng, nhóm Tính năng, thẻ app của công ty) đọc cột này, không suy từ tiền tố khoá. Migration backfill theo quy ước khoá (`han-muc-duyet` thuộc contracts) và feature tạo bằng SQL thẳng được điền theo cùng quy ước.
- Kịch bản: khi chạy migration trên dữ liệu chưa có `app` thì mọi feature có `app` hợp lệ, `han-muc-duyet` thuộc contracts [test: packages/db/src/feature-app-col.int.test.ts » backfill theo quy ước (han-muc-duyet → contracts), gỡ engine + entitlement mồ côi kèm audit, NOT NULL/CHECK/trigger]
- Kịch bản: khi lọc công ty theo Ứng dụng thì tính theo cột `app`, không theo tiền tố khoá [test: apps/admin-api/src/modules/tenants/tenants.list-app.int.test.ts » lọc app=contracts đọc cột `app`: có zz-sales (app=contracts), bỏ revoked và contracts-odd (app=other)]
- Kịch bản: khi nhóm danh mục feature thì nhóm theo cột `app` [test: apps/admin-web/src/features/features/lib/feature-meta.test.ts » nhóm theo cột app, không theo tiền tố]
## Yêu cầu: Không còn feature bật duyệt bằng quy trình (nguồn: cr121-c18-feature-app-col)
Duyệt hợp đồng bằng quy trình bật khi công ty được gán quy trình cho khe duyệt; feature `contracts-approval-engine` và các cấp phép của nó bị gỡ, không hiện ở danh mục.
- Kịch bản: khi chạy migration thì feature engine và entitlement của nó biến mất, có dòng audit [test: packages/db/src/feature-app-col.int.test.ts » backfill theo quy ước (han-muc-duyet → contracts), gỡ engine + entitlement mồ côi kèm audit, NOT NULL/CHECK/trigger]
## Yêu cầu: Ops phát hiện feature thiếu ứng dụng hoặc engine còn sót (nguồn: cr121-c18-feature-app-col)
Check `flow_coverage` báo đỏ khi feature theo quy ước thuộc một ứng dụng mà cột `app` là other, hoặc feature engine còn trong danh mục, kèm cách sửa.
- Kịch bản: khi có feature `contracts-*` với app=other thì check báo đỏ nêu key, sửa xong thì xanh [test: apps/hub-api/src/modules/ops/ops.flow-coverage.int.test.ts » CR-121 c18 · feature thiếu app (khoá thuộc ứng dụng mà cột app = other) và engine còn sót ⇒ crit nêu key, sửa xong ⇒ ok]
- Kịch bản: khi đánh giá kết quả có feature thiếu app thì crit và nối với lệch hiển thị [test: apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.test.ts » feature thiếu app (cột app = other dù khoá thuộc một ứng dụng) ⇒ crit nêu key, kèm lệch hiển thị khi có]
