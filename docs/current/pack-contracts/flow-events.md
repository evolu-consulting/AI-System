# flow events

Cập nhật: 2026-11-08 · Nguồn: cr122-a1-contracts. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Hợp đồng bắn sự kiện flow cùng giao dịch
Khi cờ flow của công ty bật, gửi duyệt / tải lên / duyệt xong ghi `contract.submitted|uploaded|approved` vào hàng đợi sự kiện cùng giao dịch với bản ghi; mã sự kiện ổn định theo bản ghi và lượt duyệt. Cờ tắt giữ đường cũ.
- Kịch bản: khi cờ bật và gửi duyệt thì có đúng một sự kiện contract.submitted kèm dữ kiện của hợp đồng, gửi lại cùng lượt không tạo thêm [test: apps/hub-api/src/modules/packs/contracts/application/contract-flow.usecase.test.ts » cờ BẬT: ghi contract.submitted sau open, cùng tx, theo lượt, không gọi engine cũ]
- Kịch bản: khi cờ tắt thì không ghi sự kiện và vẫn mở lượt theo đường cũ [test: apps/hub-api/src/modules/packs/contracts/application/contract-flow.usecase.test.ts » cờ TẮT: không ghi sự kiện, vẫn mở run theo đường cũ]
- Kịch bản: khi hợp đồng của công ty khác thì đọc dữ kiện trả về rỗng [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-flow.int.test.ts » FactsReader/OutcomeHandler của tenant khác không thấy và không đổi HĐ]

#### Yêu cầu: Kết cục Kết thúc áp lên hợp đồng một lần
Đã duyệt khoá hợp đồng và gắn sản phẩm, Từ chối, Trả lại về Nháp; gọi lại cùng lượt và kết cục trả `already_applied`.
- Kịch bản: khi định tuyến kết cục theo sự kiện thì chỉ đúng cặp (sự kiện, kết cục) đã khai được áp [test: apps/hub-api/src/modules/packs/contracts/flow-events.mount.test.ts » approved/done và uploaded/accepted không đổi HĐ, kết cục chưa hỗ trợ thì ném]
