# CR-155 · AI đọc HĐ quá lâu ⇒ hết giờ ⇒ người dùng tự nhập

## Delta
- HĐ `draft` + `extract_state = reading` quá 180 s (env `CONTRACTS_EXTRACT_READ_TIMEOUT_S`, tính từ `updated_at`: lúc yêu cầu đọc, hoặc lúc worker nhận) ⇒ vòng quét sẵn có (60 s/lượt) chuyển `failed`, `error = TIMEOUT`, lượt đọc `failed`, event `extract_failed {code: TIMEOUT}`. Giữ tệp.
- Màn chi tiết HĐ (khối «Không đọc được») nói «AI đọc quá lâu» + «Nhập tay» + «Thử lại» (`TIMEOUT` và `STALE` cùng câu).

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
