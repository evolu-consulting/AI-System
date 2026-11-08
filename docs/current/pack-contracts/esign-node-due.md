# esign node due

Cập nhật: 2026-11-08 · Nguồn: cr122-e5b-esign-due. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Hạn ký và nhắc của node áp lúc chạy
Hạn ký và chu kỳ nhắc đặt ở node được lưu theo phong bì; vòng quét ký số đọc phong bì trước, trống thì dùng bước Ký số cũ.
- Kịch bản: khi phong bì có hạn và chu kỳ nhắc ngắn hơn bước Ký số cũ thì vòng quét nhắc và chuyển cấp theo phong bì, phong bì trống thì theo bước cũ [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-sweep-envelope.int.test.ts » phong bì có hạn/nhắc ⇒ nhắc + quá hạn, phong bì trống ⇒ theo bước Ký số cũ (chưa tới hạn)]
- Kịch bản: khi gửi ký với hạn 3 ngày và nhắc mỗi 12 giờ thì phong bì lưu 72 và 12, không cấu hình node thì để trống [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » gửi ký với Group ⇒ mỗi thành viên còn dùng được là một người ký công ty, hạn/nhắc ghi trên phong bì]

#### Yêu cầu: Lưu def kiểm cấu hình node Ký số
Lưu quy trình có node Ký số cấu hình sai thì báo lỗi FLOW_NODE_CONFIG_INVALID kèm đường dẫn trường sai.
- Kịch bản: khi nhà cung cấp chưa bật thì lưu def bị từ chối và không ghi [test: apps/hub-api/src/modules/processes/defs/defs-node-config.int.test.ts » nhà cung cấp chưa bật ⇒ 422 FLOW_NODE_CONFIG_INVALID + path, không lưu]
- Kịch bản: khi cấu hình sai dạng thì báo đúng khoá [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.validator.test.ts » sai dạng ⇒ path theo khoá, sai theo công ty ⇒ path + mã của gói]

#### Yêu cầu: Người ký công ty chọn theo Group
- Kịch bản: khi chọn Group thì mọi thành viên còn dùng được ký, thành viên bị khoá bị bỏ, Group công ty khác bị chặn [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » Group ⇒ mọi thành viên còn dùng được (bỏ người bị khoá), theo thứ tự khai, bỏ trùng]
- Kịch bản: khi Group thuộc công ty khác thì kiểm lúc lưu báo lỗi và gửi ký bị từ chối [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » Group của công ty khác ⇒ không thuộc công ty (kiểm lúc lưu + từ chối lúc gửi)]
