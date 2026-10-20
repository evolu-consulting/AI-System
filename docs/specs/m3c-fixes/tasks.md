# m3c-fixes — sửa lỗi review đợt B (CR-095) phần M3

Nguồn: `docs/reviews/cr095-wave-B.md` (M3 #2, #3, #5, #6, #7, #10–#14, #26–#29). Nhánh `slice/m3c-fixes`.

| # | Mức | Làn | Sửa | Test |
|---|-----|-----|-----|------|
| 5, 6, 10 | Cao/Trung | nhanh | `extract-stream.redis.ts`: giám sát `loop()` (backoff gấp đôi tới 30 s, dừng theo `signal`); NOGROUP/UNBLOCKED ⇒ tạo lại group; giao quá `maxDeliveries` (5) ⇒ bỏ + log; `stats()` đếm restarts/groupRecreated/poison; khoá stream lỗi không bị cache | `tests/acceptance/M3C/extract-stream-recovery.int.test.ts` |
| 11 | Trung | nhanh | `withFallback` (mount): XADD lỗi sau commit ⇒ log + chạy job trong tiến trình | (qua HD3) |
| 7 | Cao | nhanh | pack 0016 `approvals.queued_at`; worker `markStarted` khi bắt đầu; quét: job xếp hàng chỉ STALE sau `CONTRACTS_QUEUE_STALE_MIN` (360'), job đang chạy sau `max(15, claimIdle+5)` phút | `adapters/approval-sweep.repo.int.test.ts` |
| 12 | Trung | nhanh | quét chuyển lượt `extracting` có HĐ đã `needs_review`/`extract_failed` ⇒ `level1`/`failed` (`healed`) | như trên |
| 26 | Trung | đầy đủ (quyền) | `finalize` tự kiểm lượt `level2` + người quyết ≠ người bắt đầu | như trên |
| 27, 28 | Trung | đầy đủ (quota) | quota + AI sẵn sàng của redo chạy SAU `decide`, chỉ khi trích lại thật; AI chưa sẵn ⇒ 503 `AGENT_UNAVAILABLE` | `application/approval-redo.test.ts` |
| 29 | Trung | nhanh | feedback chặn ký tự điều khiển | như trên |
| 13 | Trung | đầy đủ (tiền) — test trước | hub 0043 `ai_token_holds` + `ai_reserve_tokens` (advisory lock theo tenant) / `ai_release_tokens`; ai-client giữ chỗ trước khi gọi, `maxTokens` = phần cấp, quyết toán sau | `tests/acceptance/M3C/ai-cap-race.int.test.ts` (commit fa570cb9 đỏ trước code), `lib/ai-client/ai-client.reserve.test.ts` |
| 14 | Trung | nhanh | mọi lời gọi tới model ghi một dòng usage; Anthropic lỗi giữa stream ⇒ usage một phần | như trên |
| 2, 3 | Trung | nhanh | script: `--apply` dừng khi có run chưa ánh xạ (in id, `--force` để bỏ qua); in bước bắt buộc bật engine; `--verify` | `tools/scripts/src/m3-close-contract-runs.test.ts` |

## Quyết định trong lúc làm
- #7 chọn cột `queued_at` (thay vì nới ngưỡng) vì test khoá HD3 cần "`extracting` 20' ⇒ STALE"; cột thêm nullable, mặc định đặt sau ⇒ hàng cũ giữ hành vi cũ.
- #10 entry độc: ACK + XDEL + log, không ghi `extract_failed` ngay — vòng quét STALE đóng HĐ (một nguồn đóng).
- #11 dự phòng trong tiến trình thay vì 503: tx đã commit, 503 sẽ để HĐ kẹt `extracting` + 409.
- #13 Postgres (hàm SECURITY DEFINER + advisory lock) thay vì Redis Lua: AI client chỉ có DB; usage là nguồn thật ở `hub.usage_logs`. Input ước tính 2 ký tự/token (dư); còn < 1024 token output ⇒ `CAP_EXCEEDED`. Chỗ giữ hạn 2 giờ (tiến trình chết).
- #2 chọn ghi runbook trong script (+ `--verify`) thay vì tự đóng stage/task engine trong script.

## Runbook (thay dòng M3-decouple tasks.md:71)
1. `bun tools/scripts/src/m3-close-contract-runs.ts` (chạy thử) → `--apply` (dừng nếu còn run chưa ánh xạ; kiểm id rồi `--apply --force`).
2. Chạy hub với `HUB_PROCESS_ENGINE=on` tới khi vòng quét chạy ít nhất một lượt.
3. `--verify` phải thoát 0.

## Còn lại
- Số migration: pack-contracts 0016, hub 0043 — lát song song khác cũng có thể thêm số này; merge sau thì đổi số.
- #1 (migrate-hub hubDev), các mục W1/I1/F1 không thuộc lát này.
