# evotest - test:all trên máy chủ (project Docker riêng)
`powershell -File deploy/evotest/run-tests.ps1 [-Step unit|int|e2e|py|all] [-Step perf -Exclusive [-ExclusiveTimeoutMin 60]] [-Ref HEAD] [-Dirty] [-Filter "tests/a tests/b"] [-DryRun]` (cũng chạy được bằng pwsh).
- Gửi `git archive <Ref>` (+ thay đổi chưa commit nếu `-Dirty`) tới `evoc@149.202.83.5:~/workspace/evotest`, chạy `bun run test:all --no-python --only=<bước>` trong container, thoát bằng mã test.
- Project `-p evotest`: pg (Postgres 16.15, tmpfs) + redis 7.4.11 + runner (oven/bun 1.3.14; e2e: playwright v1.63.0-noble + bun). Không publish cổng, mạng riêng.
- Ngân sách: 6 CPU (3.5 + 2 + 0.5), 23 GB RAM (14 + 8 + 1), cpu_shares 128 + `nice -n 19`. Đĩa trống < 40 GB thì dừng. Ngân sách trên là của project cũ; xem mục Slot song song.
- Dọn: sau mỗi lượt `down -v` (container/mạng/tmpfs), xoá mã nguồn tạm; giữ image + `~/workspace/evotest/cache` (cache bun, < 15 GB; xoá tay khi cần).
- Log: `.data/evotest/<giờ>-<bước>/` (console.log, <bước>/ = `.data` của lượt chạy, int-s*.log, JUnit). Chưa kiểm e2e từ đầu đến cuối (kéo image Playwright lần đầu).
- Không đụng container/mạng/volume khác; không `prune`. Khoá SSH `F:\workspace\id_evoc_key` chỉ dùng qua `-i`.

## Slot song song (mặc định 8, `-Slots N` 1..8)
- Mỗi lượt chạy lấy **slot trống đầu tiên** (`boot.sh`: `mkdir .lock` nguyên tử mỗi slot, gỡ lock mồ côi theo PID owner); chỉ xếp hàng (tối đa 90 phút, exit 3) khi mọi slot bận. Slot 1 giữ khoá cũ `~/workspace/evotest/.lock` (tương thích `mgmt/run.ps1`, bản run-tests cũ); slot N>1: `~/workspace/evotest/slots/sN/.lock`.
- Slot N = project Docker `evotest-sN`, thư mục `~/workspace/evotest/slots/sN` (app/out riêng), pg tmpfs + redis riêng, không cổng; cache bun `~/workspace/evotest/cache` dùng chung. `-Capture cw` và e2e chạy trong slot đã chọn như thường.
- Ngân sách MỖI slot (máy chủ 12 CPU / 125 GB, ~106 GB trống, prod sohoptac2 + dự án khác cùng máy): trần CPU 2 + 1 + 0.25, RAM trần 5 + 4 + 0.25 = 9.25 GB; 8 slot = 74 GB RAM trần (~59%, dùng thật thấp hơn), CPU trần 26 (mềm nhờ cpu_shares 128 so với 1024 mặc định + `nice -n 19`). `res:check --server` đếm đủ 8 slot (`SERVER_SLOTS`). `evotest-mgmt` vẫn dùng khoá slot 1 (không tính vào ngân sách trên).
- Kiểm 8 slot (2026-11-03): 6 lượt `-Step int -Filter "tests/acceptance/M3 tests/acceptance/CF tests/acceptance/H2c"` (55 file) chạy song song, lấy slot s1..s5 (5 slot cùng lúc), cả 6 xanh (495 pass); trong container 212-226 s/lượt, cả lượt 247-262 s; RAM thật mỗi slot ~0,4 GB runner + ~0,3 GB pg.
- Kiểm cũ: 3 lượt `-Step int -Filter tests/acceptance/V2-A` song song chạy cùng giây ở 3 slot khác nhau, đều xanh.

## Local và evotest (Luật 0b)
- Chạy **local**: unit test + typecheck (nhanh, không cần stack). Chạy trên **evotest**: int, e2e, perf (`run-tests.ps1 -Step int|e2e|perf` hoặc `-Dirty` từ worktree của lát; archive lấy từ chính worktree đó).
- Playwright local: tối đa **2 lát cùng lúc**, mỗi lát một cổng riêng.
- Bước `py` (pytest `apps/agent-runtime`, unit + int, Linux python3.12 + `uv sync --frozen`): target `py` của `Dockerfile` (ảnh uv + git + bun cho quarantine), service `runner-py` (profile `py`, ngoài `all`); `-Filter` = đường dẫn pytest tương đối `apps/agent-runtime`; known-red suite `py`. Kiểm 2026-11-03: `-Step py -Filter "src/agent_runtime/queue src/agent_runtime/runtimes/cli tests/acceptance/result_int_test.py"` = 190 pass + 3 đỏ cũ, 93 s trong container.
- Cap CPU: slot thường pg `cpus: 1`, runner `cpus: 2` + `nice -n 19` + `cpu_shares: 128` (nhường prod). `-Exclusive` nạp thêm `docker-compose.exclusive.yml` (remote.sh `-f docker-compose.yml -f docker-compose.exclusive.yml`): pg 4 CPU, redis 1, runner 4 CPU, không nice, `cpu_shares` 1024; cấu hình dùng ghi vào `exclusive.txt` (dòng `exclusive-config`). Số perf chỉ so ngưỡng khi đo `-Exclusive`.
- `-Step perf -Exclusive` (CR-115): khoá toàn máy `~/workspace/evotest/.exclusive` (luật ở `lock.sh`, sourced bởi `boot.sh`): chờ mọi slot rảnh (timeout, exit 3), lượt thường xếp hàng khi có khoá, nhả khi lỗi/Ctrl-C/kill; load/RAM đầu-cuối vào console + `exclusive.txt`. Test: `tools/scripts/src/evotest-lock.int.test.ts`. Lượt chạy từ nhánh CHƯA có `lock.sh` bỏ qua khoá này; `mgmt/run.ps1` chỉ khoá slot 1.
- Đêm: `nightly.ps1` (Task Scheduler local) chạy `-Step all -Ref platform/gd0`, tóm tắt ở `.data/evotest/nightly-<ngày>.md`; không cron trên máy chủ.

## evotest-mgmt (I1 — bản sao mgmt-app có seed để kiểm importer)
`powershell -File deploy/evotest/mgmt/run.ps1 [-Ref HEAD] [-MgmtRepo F:\workspace\mgmt-app]` — project Docker riêng `evotest-mgmt`
(profile `mgmt`, `deploy/evotest/mgmt/docker-compose.yml`): opensearch 2.19.0 + neo4j 5.26.30-community + api build từ mã mgmt-app +
pg đích + runner; seed `app.seed.demo` (2 org) + `seed-plus.py`; chạy `mgmt-import` dry-run → apply → chạy lại, tóm tắt ở
`.data/evotest-mgmt/<giờ>/summary.txt`. Giữ `.lock` của evotest (không chồng ngân sách); 6.5 CPU / 16 GB, cpu_shares 128 + `nice -n 19`;
không cổng, dữ liệu tmpfs; dọn `down -v` + xoá thư mục + xoá image api. **Không bao giờ** đụng `sohoptac-*` (dữ liệu thật).
