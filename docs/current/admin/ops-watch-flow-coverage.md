# Admin · Ops-watch · check phủ quy trình

Cập nhật: 2026-11-09 · Gộp từ: cr120-invariants (đợt cr125-wave).

## Yêu cầu: Check quy trình hiển thị cho tenant (nguồn: cr120-invariants)
Mỗi lượt ops-watch kiểm: mọi tenant đang bật một gói có khe quy trình phải có ít nhất một quy trình (chưa xoá) trong danh sách tenant thấy của khe đó; thiếu thì check `flow_coverage` crit, nêu tên tenant và khe.
- Kịch bản: khi tenant bật gói mà việc gán chỉ nằm ở bảng gán cũ (danh sách tenant thấy rỗng) thì check crit nêu tên tenant và khe [test: apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.test.ts » tenant Demo thiếu quy trình hiển thị ⇒ crit, thông điệp có TÊN tenant + khe; apps/hub-api/src/modules/ops/ops.flow-coverage.int.test.ts » tenant chỉ có gán cũ (Demo) và tenant có def đã xoá ⇒ crit nêu tên + khe, tenant tốt và tenant không bật gói không bị nêu]
- Kịch bản: khi mọi tenant bật gói đều có quy trình hiển thị (kể cả sau khi chép gán cũ sang bảng mới) thì check ok [test: apps/hub-api/src/modules/ops/ops.flow-coverage.int.test.ts]
- Kịch bản: khi nhiều tenant thiếu thì thông điệp chỉ nêu 5 tên đầu và số còn lại, số thật nằm ở value [test: apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.test.ts » nhiều tenant ⇒ chỉ nêu 5 tên đầu và 'và N nữa', số thật nằm ở value]
- Kịch bản: khi chưa tenant nào bật gói hoặc chưa khe nào đăng ký thì check ok, không truy vấn thừa [test: apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.test.ts » chưa có khe nào đăng ký ⇒ ok, không đụng DB]
- Kịch bản: khe dlc.* không bị kiểm [test: apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.test.ts » bỏ khe dlc.*, feature = <gói>-read]
## Yêu cầu: e2e prod kiểm quy trình hiển thị (nguồn: cr120-invariants)
Bộ e2e triển khai (làn chỉ đọc) kiểm người chủ công ty demo thấy ít nhất một quy trình ở Cài đặt › Ứng dụng & quy trình và ở admin Quy trình nghiệp vụ.
- Kịch bản: khi chạy với prod thì demo-owner thấy quy trình ở cả hai nơi; NiTi chỉ chạy khi có thông tin đăng nhập [test: thủ công — e2e/deployed/20-flows-visible.ro.deployed.ts chạy với prod qua tunnel, không chạy trong lát]
