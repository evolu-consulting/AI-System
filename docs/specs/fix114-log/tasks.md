---
id: fix114-log
lát: fix114-log
cr: CR-114
làn: nhanh
migration: không
phụ thuộc: hub-otel
---
## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: sửa chính Delta chưa gộp của lát hub-otel — mặc định `LOG_FORMAT` quay về `json` ở mọi môi trường kể cả production, nên hành vi prod hiện hành không đổi; Yêu cầu "Log kv gọn cho agent đọc" trong `docs/specs/hub-otel/tasks.md` đã sửa tương ứng)

## Plan (ngắn)
Review CR-114: hub-otel đặt mặc định `kv` khi `APP_ENV=production` ⇒ consumer đọc log JSON hỏng âm thầm. Đã quét `deploy/**`, `tools/**`, `scripts/**`, `infra/**`, `.github/**`, `docs/**`, `apps/**/{deploy,scripts}`.

Consumer tìm thấy:
- `tools/scripts/src/verify-prod.ts` → `verify.rules.ts` `errorLogSummary`: `docker compose logs | grep -iE 'error|…'` rồi bỏ dòng `level":"info|debug`. Với kv `lvl=info` KHÔNG khớp ⇒ dòng info có chữ error (vd `e=error.budget.ok`) bị đếm nhầm là lỗi. (Đây là hỏng âm thầm duy nhất.)
- `log:view` (hub-otel): dòng JSON in nguyên, không đẹp.
- `deploy/prod-sohoptac2/ops-host-status.sh`, `ops-watch` (`modules/ops`): KHÔNG đọc log (ghi `host.json`/`backup.json`, kiểm health/DB).
- `docs/guides/deploy.md` `journalctl … | grep -i "watching\|logged"`: khớp từ khoá trong tên sự kiện, đúng ở cả hai dạng.
- Không có runbook/script nào `grep '"level":"error"'` hay `jq` trên log (các `jq` trong README deploy đọc file báo cáo import).

## Làm
- [x] Mặc định `json` mọi môi trường: `apps/hub-api/src/server.ts`, `apps/agent-runtime/src/agent_runtime/config.py` (`log_format`); kv chỉ khi `LOG_FORMAT=kv`.
- [x] Deploy: `LOG_FORMAT=json` trong `deploy/prod-sohoptac2/env.template`, `gen-env.sh` (prod + stg); compose `agent-runtime` (prod + stg) `LOG_FORMAT: ${LOG_FORMAT:-json}` (hub-api đọc `.env` qua `--env-file`).
- [x] `errorLogSummary` đọc cả JSON (`level`) lẫn kv (`lvl`); `log:view` đọc cả JSON hub-api/Runtime (`jsonToRecord`) và lọc `--run` cả hai.
- [x] Docs: `docs/WORKFLOW.md` "Tracing và log kv", `.env.example`.

## Không làm / Chạm
- Không đổi định dạng JSON hiện có; không chuyển prod sang kv lúc này.

## Test tối thiểu
- unit: `tools/scripts/src/verify.test.ts` (kv + JSON cùng số đếm), `tools/scripts/src/log-view.test.ts` (JSON ≡ kv), `apps/agent-runtime/src/agent_runtime/test_log_kv.py` (mặc định json kể cả production).

## Quyết định trong lúc làm
- Có consumer ⇒ mặc định json (theo yêu cầu điều phối), `LOG_FORMAT=kv` là opt-in.

## Kế hoạch chuyển prod sang kv (sau đợt này)
1. Thêm `verify:prod`/script ops nào mới thì đọc qua `recordOf`/`errorLogSummary` (đã đọc cả hai).
2. Bật thử `LOG_FORMAT=kv` ở stg (`gen-env.sh` stg) một đợt, chạy `verify:prod`-tương-đương + xem `log:view`.
3. Không còn consumer JSON ngoài repo (hỏi vận hành: cảnh báo log, dashboard) ⇒ đổi `LOG_FORMAT=kv` trong `deploy/prod-sohoptac2/gen-env.sh` (một dòng) — cần người dùng chốt.

## Việc còn lại
- Không có. Consumer ngoài repo (nếu có) chỉ vận hành biết — hỏi trước bước 3.