# seed cau hinh cong ty

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Công ty mẫu (dev/staging) có cấu hình đủ trọn (nguồn: cr125-seed)
Seed fixture công ty (evolu, demo) bật mọi tính năng của app đã cài, "Ký thử", nhóm duyệt của mẫu, mẫu Thư viện và flow mặc định (duyệt HĐ, nhận HĐ đối tác, duyệt bài Community) cùng cờ dùng quy trình mới; môi trường mới chạy được từ đầu đến cuối không phải bật công tắc nào. Chạy lại không đổi hàng nào. Production không bao giờ chạy.
- Kịch bản: khi seed chạy trên công ty đã bật gói thì mọi mẫu được gán đều dùng được (tính năng, tool, nhóm đủ) [test: tools/scripts/src/seed-cr125-config.int.test.ts » mọi mẫu được gán cho công ty đều templateReadiness ready]
- Kịch bản: khi seed xong thì ops-watch không cảnh báo cờ quy trình công ty [test: tools/scripts/src/seed-cr125-config.int.test.ts » ops-watch: flow_flag 0 công ty lệch]
- Kịch bản: khi chạy seed lần hai thì không hàng nào đổi [test: tools/scripts/src/seed-cr125-config.int.test.ts » chạy lần hai: 0 hàng đổi]

