# esign node config

Cập nhật: 2026-11-08 · Nguồn: cr122-e5-esign-node-config. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Node Ký số có cấu hình riêng, ghi đè cài đặt chung
Node Ký số nhận nhà cung cấp, người ký công ty, đối tác ký, thứ tự, hạn, nhắc ở `args` của stage gửi ký; trường trống lấy cài đặt ký số chung của công ty.
- Kịch bản: khi node chỉ định nhà cung cấp và người ký thì phong bì dùng đúng nhà cung cấp và người ký đó, không có cấu hình thì dùng mặc định công ty và người bắt đầu [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » không args ⇒ nhà cung cấp mặc định + người bắt đầu, có args ⇒ nhà cung cấp, người ký, thứ tự theo node]
- Kịch bản: khi người ký thuộc công ty khác thì bị từ chối và không tạo phong bì [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » người ký thuộc công ty khác / không tồn tại ⇒ từ chối, không tạo phong bì]

#### Yêu cầu: Panel node lấy lựa chọn và kiểm cấu hình trước khi lưu
- Kịch bản: khi mở panel thì chỉ thấy nhà cung cấp đang bật và Group của công ty, lưu với nhà cung cấp chưa bật hoặc người ký ngoài công ty thì báo lỗi theo trường [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » GET options: chỉ nhà cung cấp đang bật + mặc định, kiểm cấu hình khi lưu def báo lỗi theo trường]
- Kịch bản: khi đọc args thì tool áp đúng cấu hình và từ chối cấu hình sai [test: apps/hub-api/src/modules/packs/contracts/adapters/intake.tools.esign-node.test.ts » cấu hình sai ⇒ lỗi rõ theo khoá, không gửi]
