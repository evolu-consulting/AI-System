---
id: cr115-perf-exclusive
lát: cr115-perf-exclusive
cr: CR-115
làn: nhanh
migration: không
phụ thuộc: không
---
## Plan (ngắn)
`run-tests.ps1 -Step perf -Exclusive`: đo hiệu năng trên máy yên. Chờ mọi slot evotest rảnh, giữ khoá toàn máy trong lúc đo, nhả khoá dù lỗi.

## Làm
- `deploy/evotest/lock.sh` (mới, luật khoá): `.exclusive` (mkdir nguyên tử, owner `PID ts commit tag`); `ex_acquire` (giữ trước để không bị đói, rồi chờ mọi slot rảnh, tiến độ mỗi 30 s, hết hạn ⇒ nhả + exit 3),
  `ex_drain`, `ex_held` (owner chết ⇒ gỡ mồ côi), `ex_release` (đúng tag), `snap` (load/nproc/RAM/slot bận).
- `boot.sh`: source `lock.sh` (scp riêng như boot.sh); lượt thường xếp hàng khi `ex_held`, kiểm lại sau khi lấy slot (đóng cửa sổ chạy đua); lượt exclusive in `exclusive-start`/`exclusive-end` (load/RAM/slot),
  chạy `remote.sh` nền + trap EXIT/INT/TERM/HUP ⇒ dừng container, nhả slot + `.exclusive`.
- `run-tests.ps1`: `-Exclusive` (chỉ với `-Step perf`), `-ExclusiveTimeoutMin` (mặc định 60), ghi `exclusive.txt`, `finally` bảo máy chủ kill đúng boot của lượt (theo tag) khi Ctrl-C.
- `res:check --server`: dòng `exclusive=` ⇒ `ServerMetrics.exclusive`, cảnh báo, khuyến nghị 0 slot, hiện ở hàng SERVER slot.
- Docs: WORKFLOW (bullet cạnh `-Step py`), `deploy/evotest/README.md`.

## Không làm / Chạm
Không đổi bước/khoá của int/e2e/py; không chặn `mgmt/run.ps1` (chỉ giữ khoá slot 1 như cũ). Chạm: deploy/evotest/{lock.sh,boot.sh,run-tests.ps1,README.md}, tools/scripts/src/res-check.{parse,rules}.ts, docs/WORKFLOW.md.

## Test tối thiểu
- `tools/scripts/src/evotest-lock.int.test.ts` (bash thật trên thư mục tạm, Linux): 9 ca — owner sống/chết/mồ côi, ex_acquire/ex_release theo tag, lượt exclusive khác còn sống ⇒ hết hạn exit 3 không gỡ khoá của họ,
  slot bận quá hạn ⇒ exit 3 + nhả, slot nhả giữa chừng ⇒ chờ xong rồi giữ; boot.sh: lượt thường xếp hàng và chỉ chạy SAU khi exclusive xong (thứ tự ghi log), exit 5 truyền ra + nhả khoá, SIGTERM nhả khoá, timeout exit 3. Chạy ở evotest: 9 pass.
- `res-check.test.ts`: 22 pass (ca mới `exclusive=busy`).

## Quyết định trong lúc làm
- Luật nằm trong file bash riêng (không chép sang TS) để test chính đoạn chạy thật; test là `*.int.test.ts` vì `test:int:par` là cách chạy một file trên Linux evotest (Windows bỏ qua, không có bash/ /proc).
- Giữ `.exclusive` TRƯỚC khi chờ drain (chống đói) và kiểm lại sau khi lấy slot của mình; lượt thường kiểm lại sau khi lấy slot.
- Lượt chạy từ nhánh cũ (boot.sh không biết `.exclusive`) vẫn chen vào: lần đo thử 1 thấy `slot_ban=[s2]` ở `exclusive-end` do một lượt của worktree khác ⇒ chỉ chặn được sau khi merge; đã ghi ở docs.

## Số đo chứng minh (evotest, `-Step perf -Exclusive -Filter tests/acceptance/P-d/perf/background.perf.int.test.ts`, hai lượt)
| lượt | load1 đầu→cuối | PD-P13 p50 / p95 (ms) | PD-P14 p50 / p95 (ms) | ghi chú |
|---|---|---|---|---|
| 1 | 1,37 → 2,13 | 47 / 75 | 36 / 72 | cuối có s2 bận (lượt của nhánh cũ chen vào) |
| 2 | 2,86 → 2,47 | 47 / 76 | 38 / 61 | slot sạch cả đầu lẫn cuối (đã chờ s1 rảnh) |
Khi máy tải (số đã biết): PD-P14 p95 55–69 ms. Exclusive KHÔNG kéo p95 xuống ≤ 50 ms: cả 2 lượt PD-P13/P14 vẫn đỏ ngưỡng p95 50 ms (và tổng 10.000 task 6,1–6,3 s > 6 s).
Nguyên nhân còn lại không phải tranh slot: tải nền máy chủ 1,4–2,9 (prod + dự án khác), và slot bị hạn `cpus: 1` cho PG + `nice 19` + `cpu_shares 128` (docker-compose.yml). Gợi ý lát sau: profile `perf` nới CPU của PG khi `-Exclusive` (máy đã yên).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: công cụ chạy test evotest và res:check; không đổi mã sản phẩm).

## Việc còn lại
- Nới `cpus`/`cpu_shares` của PG+runner khi `-Exclusive` (hiện hạn 1 CPU) rồi đo lại PD-P13/P14; sau merge, các nhánh khác tự chịu khoá khi rebase.
