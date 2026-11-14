# fix-purchase-timer — e2e «Quy trình mua hàng» Phần 2 kẹt `waiting_timer` (hẹn `wait_until` +7 ngày)

Nguyên nhân: commit `0bfbec51f` (CR-146b) cho `withEsignSigner` (seed bản công ty của Phần 2) điền `provider: upload`. Bước «Ký số» = 2 stage (gửi + `wait_event esign.completed`, `timeout_h` 168 ⇒ hẹn `wait_until` +7 ngày). «Tải lên bản đã ký» không tạo phong bì, chờ người tải lên ⇒ e2e (Giám đốc «Ký thử») không thấy «Ký ngay», lượt kẹt `waiting_timer`. Không phải hồi quy của fix-wait-until-warning / CR-152a.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Seed «Quy trình mua hàng» điền «Ký qua» = nhà cung cấp mà seed bật cho công ty
Bước Ký của Phần 2 «Hợp đồng» trong bản công ty do seed tạo có «Ký qua» = «Ký thử» (`selfsign`, cùng nhà cung cấp `writeCr125Config` bật cho công ty) và người ký = nhóm Giám đốc; không dùng «Tải lên bản đã ký» (chờ người tải lên, hẹn hạn 7 ngày). Giá trị đã có trong mẫu được giữ nguyên.
- Kịch bản: khi seed điền «Ký qua» cho bước gửi ký còn trống thì dùng «Ký thử», giữ giá trị đã có, không đụng bước khác [test: apps/hub-api/src/modules/seed/seed.cr125-config.test.ts » withEsignSigner]
- Kịch bản: khi seed công ty thì bước Ký số của Phần 2 có «Ký qua» = Ký thử + người ký nhóm Giám đốc, hợp lệ theo `esignConfigIssues` [test: apps/hub-api/src/modules/seed/seed.cr125-esign-signer.int.test.ts » seed công ty: bước Ký số của Phần 2 có người ký nhóm Giám đốc]

## Quyết định trong lúc làm
- Luật: CR-146b «node Ký bắt buộc Ký qua» — seed chọn nhà cung cấp theo cái seed bật cho công ty (selfsign), không chọn `upload` (đổi quyết định ở `docs/specs/cr146b-sign-per-flow/tasks.md` «seed withEsignSigner thêm provider: upload»).
- Không sửa `seed-cr128-flows.ts` (explicit `upload` cho flow riêng) và `tools/demo/purchase-flow-def.ts` (demo script riêng).
