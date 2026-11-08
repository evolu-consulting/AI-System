# Hub · Điều khiển lượt chạy (dừng, chạy lại)

Cập nhật: 2026-11-09 · Gộp từ: cr121-r1-run-control (đợt cr125-wave).

## Yêu cầu: Dừng lượt chạy (nguồn: cr121-r1-run-control)
Quản trị (platform_admin; tenant_admin cùng tenant) dừng run chưa kết thúc kèm lý do: run `cancelled`, việc duyệt mở đóng, hẹn huỷ,
ghi người dừng + lý do + thời điểm vào audit. Bấm lại ⇒ cùng kết quả. Kết quả job đến sau khi dừng không đổi trạng thái.
- Kịch bản: khi tenant_admin dừng run đang chạy hai lần đồng thời thì cả hai 200, một audit, job trả muộn không ghi đè [test: tests/acceptance/CR-121/run-control.int.test.ts » Dừng: tenant_admin dừng run đang chạy hai lần đồng thời ⇒ cancelled, một audit, job trả muộn không ghi đè]
- Kịch bản: khi thành viên dừng thì 403; tenant_admin tenant khác thì 404; thiếu lý do thì 400 [test: tests/acceptance/CR-121/run-control.int.test.ts » Quyền: thành viên 403, tenant_admin tenant khác 404, tenant_admin chạy lại bước 403]

## Yêu cầu: Chạy lại bước (nguồn: cr121-r1-run-control)
Chỉ platform_admin; bước lỗi hoặc đã xong; trong CÙNG run chạy lại từ bước đó trở đi (vòng tăng), kết quả cũ giữ, audit lý do.
- Kịch bản: khi platform_admin chạy lại bước 2 của run xong hai lần đồng thời thì một lần quay lại (200 + 409), run chạy tới xong với output mới [test: tests/acceptance/CR-121/run-control.int.test.ts » Chạy lại bước: platform_admin trên run xong hai lần đồng thời ⇒ một lần quay lại, cùng run, kết quả cũ giữ]
- Kịch bản: khi tenant_admin chạy lại bước thì 403 [test: tests/acceptance/CR-121/run-control.int.test.ts » Quyền: thành viên 403, tenant_admin tenant khác 404, tenant_admin chạy lại bước 403]
- Kịch bản: luật vai × thao tác và trạng thái được phép [test: apps/hub-api/src/modules/processes/domain/runs/run-control.rules.test.ts » Chạy lại bước: bước lỗi/xong, run đã dừng/hết hạn ⇒ không]

- Kịch bản: khi chạy lại bước đã xong trong lúc bước sau đang chạy thì kết quả muộn của bước sau không ghi vào run [test: tests/acceptance/CR-121/run-control.int.test.ts » Chạy lại bước đã xong khi run đang chạy bước sau ⇒ kết quả muộn của bước sau không ghi vào run]

## Yêu cầu: Chạy lại cả lượt (nguồn: cr121-r1-run-control)
platform_admin hoặc tenant_admin cùng tenant; run đã kết thúc, không gắn gói; tạo run MỚI cùng định nghĩa đã chụp + đầu vào, `rerun_of` = run cũ.
- Kịch bản: khi chạy lại run đã dừng hai lần đồng thời thì một run mới (201 + 200 cùng id), cùng snapshot + input, chạy tới xong [test: tests/acceptance/CR-121/run-control.int.test.ts » Chạy lại cả lượt: run đã dừng, hai lần đồng thời ⇒ một run mới rerun_of cùng snapshot + input]
- Kịch bản: luật chỉ run đã kết thúc, không gắn gói [test: apps/hub-api/src/modules/processes/domain/runs/run-control.rules.test.ts » Chạy lại cả lượt: chỉ run đã kết thúc, không gắn gói]
