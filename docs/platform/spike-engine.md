# Spike ADR-0017 — engine chạy bền

Câu hỏi: process engine hiện có (`apps/hub-api/src/modules/processes/`) có chạy đúng cho quy trình nghiệp vụ kéo dài
nhiều tháng không, hay cần một engine chạy bền bên dưới (Temporal / Restate)?

Thời hạn: 2 tuần. Kết quả: báo cáo pass/fail từng bài + đề xuất, ghi vào ADR-0017.

## Engine hiện có (đã đọc code)

| Cơ chế | Ở đâu | Ghi chú |
|---|---|---|
| Hàng đợi job | `hub.jobs`, `runner/job/runner.repo.ts`, `runner/orphan-sweep.ts` | SKIP LOCKED, lease, heartbeat, quét mồ côi |
| Vòng quét process | `processes/runs/sweeps.ts` `sweepOnce` (mỗi ~3 s) | Kick lại stage `queued` mồ côi; đánh `interrupted` khi run kết thúc > 60 s; **hết hạn run sau 7 ngày** |
| Nhắc task | `processes/notify/reminder.ts` `remindOnce` (mỗi 5 phút) | Nhắc **một lần** sau `REMIND_AFTER_H` |
| Snapshot định nghĩa | `process_runs.snapshot` + `def_version` | Sửa template không đổi run đang chạy |
| Đồng hồ | seam `d.now` trong `ProcessDeps` | Test điều khiển được thời gian |
| Gọi tay vòng nền | `ProcessHandles.sweepOnce` / `remindOnce`, `processLoops:false` | Test không cần chờ thật |

## Sáu bài thử lỗi

| # | Bài | Cách chạy trên engine hiện có | Đạt khi |
|---|---|---|---|
| 1 | Sập giữa bước | Bắt đầu run, tắt worker khi stage `running`, chạy `sweepOnce` sau 60 s (dời `d.now`) | Stage được chạy lại **đúng một lần**, không tạo hai output |
| 2 | Chạy trùng | Gửi cùng yêu cầu start hai lần (cùng khoá idempotency) | Chỉ một `process_run` |
| 3 | Hẹn giờ qua restart | Đặt nhắc ở ngày D+3, khởi động lại Hub, dời `d.now` tới D+3 | Nhắc bắn một lần |
| 4 | Quá hạn | Task người duyệt quá hạn | Nhắc + chuyển cấp đúng quy định |
| 5 | Đổi version | 100 run đang chạy, sửa template | Run cũ giữ snapshot cũ |
| 6 | Tải | 10.000 run đồng thời trên staging | Không mất, không kẹt; p95 trong NFR |

## Khoảng trống đã thấy trước khi chạy

| Khoảng trống | Ảnh hưởng | Hướng xử lý nếu mở rộng engine hiện có |
|---|---|---|
| Run **hết hạn sau 7 ngày** (`expires_at` bắt buộc) | Quy trình hợp đồng sống nhiều tháng sẽ bị `expired` | Cho phép `expires_at` rỗng theo loại flow, hoặc tạm dừng run khi chờ ngày |
| Nhắc chỉ **một lần**, theo giờ cố định | Không có "chờ đến ngày D", không nhắc lặp | Bảng hẹn giờ (`due_at`, `fired_at`, khoá idempotency) + node `wait_until` |
| Không có khoá idempotency khi start | Bài 2 dễ trượt | Cột khoá idempotency unique theo tenant |
| Bài 4: chưa có chuyển cấp | Không đáp ứng "quá hạn thì chuyển người" | Quy tắc chuyển cấp trong định nghĩa node duyệt |

## Hai phương án so sánh

| | (a) Mở rộng engine hiện có | (b) Temporal / Restate bên dưới |
|---|---|---|
| Công | Thêm bảng hẹn giờ, khoá idempotency, bỏ hết hạn cứng | Dựng cụm, viết worker, map định nghĩa flow sang workflow code |
| Vận hành | Không thêm hệ thống | Thêm một hệ thống lớn cần HA, sao lưu |
| Rủi ro | Phải tự đúng ở mọi tình huống lỗi | Chạy bền là tính năng sẵn có |
| Giữ RLS, audit, review task | Có sẵn | Phải nối lại |

Quy tắc chọn: chọn phương án ít công vận hành hơn **trong số các phương án qua cả sáu bài**.

## Chạy spike

`spikes/engine/engine.spike.test.ts`, ngoài `tests/acceptance/**` (không đụng khoá test, bị `bun test` bỏ qua):

```
scripts\dev-db.ps1 -Wait
bun --env-file=.env.local --config=bunfig.int.toml test --timeout 300000 spikes/engine/engine.spike.test.ts
```

## Kết quả (2026-10-17)

4 đạt (2, 3a, 5, 6), 4 đỏ (1, 3b, 4, 4b). Chi tiết và đề xuất: ADR-0017. Tóm tắt:
- Đạt: không chạy trùng, nhắc an toàn qua khởi động lại, giữ snapshot khi đổi version, 1.000 task nhắc trong 11 lượt (p95 537 ms/lượt).
- Đỏ: job lỗi không tự thử lại (chuyển `needs_decision`), chưa có hẹn ngày / tool / rẽ nhánh, chỉ nhắc một lần, run hết hạn sau 7 ngày.
- Đề xuất: phương án (a), mở rộng engine hiện có.
