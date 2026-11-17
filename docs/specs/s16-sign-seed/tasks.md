---
id: s16-sign-seed
lát: s16-sign-seed
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s2-sig-api
---
# s16-sign-seed — dữ liệu mẫu UAT «Ký trên tài liệu»

## Plan (ngắn)
Script seed chỉ THÊM cho tenant demo của bản test (stg-test hoặc máy dev): bật `on_doc_enabled`, quy trình «Duyệt và ký hợp đồng (ký trên tài liệu)» (bước Ký `ondoc`), HĐ Nháp mẫu + 2 PDF. Tranh chấp bộ chọn quy trình: điều kiện hẹp (phòng Kinh doanh + ≤ 100 triệu), đứng đầu thứ tự; ghi trong UAT.

## Làm
- [x] `tools/scripts/src/seed-cr181-sign.data.ts` (+ `.data.test.ts`): guard, thiết lập, quy trình, PDF (pdf-lib + Be Vietnam Pro), kế hoạch idempotent.
- [x] `tools/scripts/src/seed-cr181-sign.ts`: IO (API hub + SQL tạo HĐ Nháp như seed-kind-samples).
- [x] `deploy/stg-test/seed-demo.sh`: cờ `--sign-only`.
- [x] `docs/uat/ky-tren-tai-lieu.md`: kịch bản 3 vai + điện thoại 390px.

## Không làm / Chạm
Không chạy seed trên máy chủ, không prod, không tạo chữ ký sẵn, không thêm thư viện.

## Test tối thiểu
`bun test tools/scripts/src/seed-cr181-sign*.test.ts` (8 ca: guard, thiết lập, quy trình, kế hoạch, PDF 6 trang có «ĐẠI DIỆN BÊN A»).

## Quyết định trong lúc làm
- `pdf-lib`/fontkit chỉ khai ở hub-api ⇒ nạp bằng `createRequire` theo `apps/hub-api/package.json` (không thêm thư viện, không sửa lockfile).
- Bước Ký đặt `provider = "ondoc"` thẳng (regex hiện cho phép); lát s9 thêm giá trị vào enum/UI sau.
- Không đặt «Cần ký» trong seed: UAT để sale tự bật/chuẩn bị chỗ ký (cần endpoint s8, chưa chắc có trên staging).
- Chưa kiểm chạy thật (chỉ điều phối chạy khi deploy): endpoint `/company/signature-settings`, `/company-flows/order` theo seed cũ + s2.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: seed + tài liệu UAT)

## Việc còn lại
Chạy thật `seed-demo.sh --sign-only` trên bản test khi deploy (điều phối); nếu `ondoc` bị API từ chối ở bước lưu quy trình thì chờ s9.
