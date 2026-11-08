# Tools · Công cụ seed-niti

Cập nhật: 2026-11-09 · Gộp từ: fix-niti-approval-feature, tool-seed-niti (đợt cr125-wave).

## Yêu cầu: seed-niti cấp feature duyệt HĐ (nguồn: fix-niti-approval-feature)
`seed-niti --apply` cấp feature công ty `contracts-approval-engine` cho tenant (idempotent, qua service Admin); chạy thử chỉ in "sẽ cấp".
- Kịch bản: khi --apply thì tenant có entitlement còn hiệu lực, chạy lại không đổi [test: tools/scripts/src/seed-niti.int.test.ts » --apply tạo đủ và mật khẩu chỉ ở file, không ở log]

## Yêu cầu: Nạp tenant khách NiTi Group bằng một lệnh chạy lại được (nguồn: tool-seed-niti)
Công cụ `seed-niti` chạy thử mặc định, ghi khi `--apply`, đi qua service của ứng dụng; chạy lại không đổi gì; mật khẩu tạm chỉ ở file.
- Kịch bản: khi chạy thử thì không hàng nào ở admin/hub đổi [test: tools/scripts/src/seed-niti.int.test.ts » chạy thử không ghi gì (kể cả file mật khẩu)]
- Kịch bản: khi `--apply` thì tenant, phòng ban, user, vai gói, 3 quy trình xuất bản + gán, luật phòng × loại HĐ được tạo và mật khẩu chỉ ở file [test: tools/scripts/src/seed-niti.int.test.ts » --apply tạo đủ và mật khẩu chỉ ở file, không ở log]
- Kịch bản: khi chạy lại thì mọi bước báo "không đổi" và số hàng/phiên bản cấu hình giữ nguyên [test: tools/scripts/src/seed-niti.int.test.ts » chạy lại = không đổi gì]
- Kịch bản: khi tenant trùng tên khác khoá thì từ chối, không ghi [test: tools/scripts/src/seed-niti.int.test.ts » tenant trùng tên nhưng khác khoá ⇒ từ chối, không ghi]
- Kịch bản: khi `--apply` trên DB không phải localhost/test mà thiếu `--i-know-prod` thì từ chối [test: tools/scripts/src/seed-niti.rules.test.ts » guard: apply ngoài localhost hoặc production cần --i-know-prod, chạy thử luôn được]
