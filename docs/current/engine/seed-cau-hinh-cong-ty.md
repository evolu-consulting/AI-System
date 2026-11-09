# seed cau hinh cong ty

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Công ty mẫu (dev/staging) có cấu hình đủ trọn (nguồn: cr125-seed)
Seed fixture công ty (evolu, demo) bật mọi tính năng của app đã cài, "Ký thử", nhóm duyệt của mẫu, mẫu Thư viện và flow mặc định (duyệt HĐ, nhận HĐ đối tác, duyệt bài Community) cùng cờ dùng quy trình mới; môi trường mới chạy được từ đầu đến cuối không phải bật công tắc nào. Chạy lại không đổi hàng nào. Production không bao giờ chạy.
- Kịch bản: khi seed chạy trên công ty đã bật gói thì mọi mẫu được gán đều dùng được (tính năng, tool, nhóm đủ) [test: tools/scripts/src/seed-cr125-config.int.test.ts » mọi mẫu được gán cho công ty đều templateReadiness ready]
- Kịch bản: khi seed xong thì ops-watch không cảnh báo cờ quy trình công ty [test: tools/scripts/src/seed-cr125-config.int.test.ts » ops-watch: flow_flag 0 công ty lệch]
- Kịch bản: khi chạy seed lần hai thì không hàng nào đổi [test: tools/scripts/src/seed-cr125-config.int.test.ts » chạy lần hai: 0 hàng đổi]

#### Yêu cầu: Công ty mẫu gửi ký số được ở Phần 2 «Hợp đồng» (nguồn: cr126-seed-esign-signer)
Công ty mẫu có nhóm Giám đốc nhận sẵn bản công ty của Phần 2 «Hợp đồng» với người ký công ty = nhóm Giám đốc; không có công tắc tay nào còn thiếu trước bước «Ký số».
- Kịch bản: khi seed công ty mẫu thì bước «Ký số» của lượt con Phần 2 có người ký là nhóm Giám đốc và chạy lại không nhân đôi [test: apps/hub-api/src/modules/seed/seed.cr125-esign-signer.int.test.ts » seed công ty: bước Ký số của Phần 2 có người ký nhóm Giám đốc]

#### Yêu cầu: Công ty mẫu demo chạy trọn «Quy trình mua hàng» ngay sau seed (nguồn: cr126-demo-purchase-seed)
Tài khoản demo-owner (giám đốc), demo-viewer (kế toán), demo-editor (nhân viên) được xếp sẵn vào các nhóm duyệt theo vai (`PURCHASE_ROLE_GROUPS`); mỗi dòng «cùng duyệt» có ít nhất hai người khác nhau; flow cha đã gán và Bật; không cần thao tác tay.
- Kịch bản: khi seed công ty demo thì flow cha đã Bật, mỗi nhóm duyệt có thành viên, mỗi dòng cùng duyệt có ≥ 2 người khác nhau và chạy lại 0 đổi [test: apps/hub-api/src/modules/seed/seed.cr126-demo-purchase.int.test.ts » cha gán + Bật, mọi nhóm có người, dòng cùng duyệt ≥ 2 người khác nhau, chạy lại 0 đổi]

