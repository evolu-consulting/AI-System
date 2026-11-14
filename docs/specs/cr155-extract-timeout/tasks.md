# CR-155 · AI đọc HĐ quá lâu ⇒ hết giờ ⇒ người dùng tự nhập

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md

#### Yêu cầu: AI đọc quá lâu thì hết giờ và người dùng tự nhập
HĐ đang để AI đọc (`reading`) quá 180 giây (env `CONTRACTS_EXTRACT_READ_TIMEOUT_S`, tính từ lúc yêu cầu đọc hoặc lúc worker nhận) thì máy chủ coi như đọc lỗi mã `TIMEOUT`, giữ tệp; kết quả AI về muộn bị bỏ. Màn chi tiết nói «AI đọc quá lâu» kèm «Nhập tay» và «Thử lại».
- Kịch bản: khi HĐ đang đọc quá hạn thì vòng quét chuyển đọc lỗi mã TIMEOUT [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-sweep.repo.int.test.ts » đọc quá 3 phút (xếp hàng hoặc đang chạy) ⇒ TIMEOUT, lượt failed, event code TIMEOUT, đọc 1 phút ⇒ giữ]
- Kịch bản: khi kết quả AI về sau hết giờ thì bị bỏ, HĐ vẫn đọc lỗi [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-sweep.repo.int.test.ts » kết quả AI về sau hết giờ ⇒ BỎ (CAS extract_state = reading): HĐ vẫn failed, mã TIMEOUT]
- Kịch bản: khi mở HĐ đọc hết giờ thì thấy «AI đọc quá lâu», Nhập tay và Thử lại [test: e2e/contracts-web/gapa1-manage.cw.ts » editor: đọc hết giờ (TIMEOUT) ⇒ nêu «AI đọc quá lâu», có Nhập tay và Thử lại]
- Kịch bản: khi mã lỗi đọc là TIMEOUT hoặc STALE thì màn dùng câu lý do hết giờ [test: apps/workspace-web/src/features/contract-review/lib/fail-reason.test.ts » TIMEOUT và STALE ⇒ timeout (AI đọc quá lâu)]


## Quyết định trong lúc làm
- Một nguồn: mở rộng điều kiện `stale` của `approval-sweep.repo.ts` (không thêm vòng quét/migration); mã lỗi `TIMEOUT` đã có sẵn trong `extraction.ports.ts`.
- Kết quả AI về SAU hết giờ ⇒ BỎ: `saveResult`/`saveFailure` đã CAS `extract_state = 'reading'` (+ `version`); job tới muộn thấy `failed` ⇒ `skipped`, không gọi lại AI ghi đè. Người dùng muốn thì «Thử lại».
- Không huỷ được lời gọi AI đang chạy ở instance khác (không có kênh huỷ liên-instance); lời gọi vẫn bị chặn bởi `CONTRACTS_EXTRACT_TIMEOUT_S` (300 s) rồi kết quả bị bỏ.
- Hạn đọc 180 s < hạn STALE (≥ 15') ⇒ trường hợp thực tế đều ra `TIMEOUT`; `STALE` còn khi env đặt hạn đọc lớn hơn.

## Việc
| # | Việc | Rủi ro | Đọc | Test |
|---|---|---|---|---|
| 1 | Sweep: `reading` quá hạn ⇒ failed/TIMEOUT | cao | `adapters/approval-sweep.repo.ts`, `application/approval-sweep.ts` | [test: apps/hub-api/src/modules/packs/contracts/application/approval-sweep-timeout.test.ts], [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-sweep.repo.int.test.ts] |
| 2 | UI lý do hết giờ (i18n vi/en) | thường | `contract-review/lib/fail-reason.ts` | [test: apps/workspace-web/src/features/contract-review/lib/fail-reason.test.ts], [test: e2e/contracts-web/gapa1-manage.cw.ts] |
