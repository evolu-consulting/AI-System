# esign expire claim

Cập nhật: 2026-11-08 · Nguồn: cr122-e5d-expire-claim. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Huỷ phong bì quá hạn chỉ một lần và đúng phong bì
Huỷ phong bì quá hạn của node Ký số giành quyền trước khi gọi nhà cung cấp, chỉ bên giành được mới huỷ và bắn esign.voided, và chỉ chạm đúng phong bì đã quét.
- Kịch bản: khi nhiều lượt cùng huỷ một phong bì thì nhà cung cấp bị gọi một lần và chỉ có một sự kiện [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-expire-claim.int.test.ts » nhiều lượt cùng huỷ một phong bì ⇒ nhà cung cấp bị gọi một lần, một sự kiện esign.voided]
- Kịch bản: khi gửi lại phong bì mới sau khi quét thì phong bì mới không bị huỷ nhầm [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-expire-claim.int.test.ts » gửi lại phong bì mới sau khi quét ⇒ phong bì mới không bị huỷ nhầm, tham chiếu cũ không chạm được]
- Kịch bản: khi tiến trình chết sau khi giành quyền thì hết lease lượt sau giành lại được [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-expire-claim.int.test.ts » tiến trình chết sau khi giành quyền ⇒ trong lease không ai huỷ, hết lease lượt sau giành lại]

#### Yêu cầu: Kiểm cấu hình ký số theo khoá tool
- Kịch bản: khi def gọi thẳng tool gửi ký không mang node thì vẫn bị kiểm lúc lưu [test: apps/hub-api/src/modules/processes/defs/defs-node-config.int.test.ts » E5d · def gọi thẳng tool gửi ký KHÔNG mang `node` vẫn bị kiểm (validator theo khoá tool)]
