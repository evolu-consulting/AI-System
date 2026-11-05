---
id: cr121-t1-wave-speed
lát: cr121-t1-wave-speed
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

`verify:wave` (lượt cuối đợt, 2026-11-05) chạy 545 file int + 15 việc e2e trên 7 slot evotest mất ≈ 15 phút (thùng 5: int 722 s rồi e2e 171 s = 893 s; thùng nhẹ nhất 192 s).
Nguyên nhân: (1) chia thùng theo SỐ thư mục (`waveFilters` → `chunkEven`, mỗi thư mục tính 3 s) chứ không theo thời lượng; (2) `int-timings.json` toàn 0 vì JUnit bun 1.3.14 ghi `time="0"` cấp file ⇒ LPT trong `test:int:par` vô hiệu; (3) việc e2e `root` (941 s ca) và `contracts-web` (453 s) chạy nguyên khối một slot; (4) `settleRuns` (afterEach của ~45 file int H2b/H2c/…) chờ cả 5 s các run mà hub này không huỷ được.

## Đo (lượt 2026-11-05 23:05–23:21, nguồn `.data/evotest/20261105-23*`)

Pha một lệnh evotest (int `-Filter` 197 file): probe 2,8 s · push mirror 4 s · prep 0,1 s · upload 3,5 s · server 706 s (dbtpl restore 8 s, container + `bun install`/setup 7 s, **test 654 s**, dọn cache ≈ 3 s) · fetch 4,4 s. e2e (4 việc root): setup 4 s, build-cache 8,5 s dựng, test 617 s. ⇒ chi phí cố định ≈ 35 s/lệnh, phần còn lại là chạy test; không phải upload/DB.
Slot: int 722 / 522 / 498 / 192 s; e2e root 653, contracts-web 487, 307, 292, 188, 171, 111 s. Tổng ca đỏ e2e tốn thêm ≈ 25 × 30 s chờ hết giờ (đỏ có sẵn của đợt, đã tính trần 8 s trong cache mới).

Top 15 file int chậm (giây, 1 worker, gồm beforeAll): rls-packs 58 · H2c/command-file 32,5 · FB1/bytes 31,8 · admin-api/lib/lock-order 31 · M3/concurrency 30,4 · N1/migrate 29,7 · db/migrate-hub 27,7 · H2b/run-limit 25,9 · M2/concurrency 24,7 · H1/lease 23,3 · H2c/agent-job 17,6 · H2a/dify-agent 14,8 · packs/contracts/category-ids 12,6 · H2a/async 12,1 · H2a/mcp 12.
Top 15 spec e2e chậm (giây): x1/command-test 69,5 · journey/cr121-d-journey 58,6 · root/access-matrix 57,3 · commands 54,4 · m4-2fa 50,2 · fnr/editor 49,1 · studio/h4b1-secrets 49 · x1/groups-agent 47,7 · community-web-stack/roles 46,5 · N1/shell 46,2 · community-web-stack/flows 77,7 · contracts-web/scenes 40,7 · studio/h4b2-models 40,3 · studio/k1-knowledgehub 37,5 · root/app-roles 36,7. Test lẻ chậm nhất xanh: 20 s (flows.cs · đối tác đăng bài); 30 s là ca đỏ chờ hết giờ.

## Làm

- `wave-plan.rules.ts`: LPT theo thời lượng đo (int/file, e2e mảnh), có chi phí lệnh 35 s, 2 worker int + 2 làn e2e mỗi slot; việc e2e > 150 s (gồm dựng stack) chia mảnh: root theo file spec (spec ghim cổng 3000 ở mảnh 0, spec đồng hồ giả riêng), việc khác bằng `playwright --shard=i/n`; mảnh cùng cấu hình không chung thùng.
- `e2e-pieces.rules.ts` + `test-e2e-par.rules.ts`: `--only` nhận token mảnh tường minh (`root@k=file+file`, `việc@i/n`) ⇒ slot không tự tính lại (cache khác nhau không làm lệch/trùng/sót file).
- `wave-timings.ts/.rules.ts` + `tools/scripts/wave-timings.json`: cache thời lượng (int, e2e theo file, boot theo việc), tự cập nhật sau mỗi `verify:wave`; ca đỏ tính trần 8 s.
- `test-int-par.watchdog.ts/.run.ts/.ts`: đo thời lượng file theo header→header (gồm beforeAll) thay số 0 của JUnit ⇒ LPT của `test:int:par` hoạt động.
- `verify-wave.ts`: dùng kế hoạch trên; `--plan` (chỉ in kế hoạch + giây dự kiến), `--slots=N`; int chạy `-Workers 2`.
- Sửa test chậm do chờ hết giờ: `tests/acceptance/H2b/_h2b.ts` `settleRuns` chỉ chờ run mình huỷ được, run còn lại kết thúc SQL ngay (trước: ngủ 5 s mỗi afterEach; thấy ở FB1/bytes h2/h3/h5 mỗi ca 5,0 s). Không xoá/đổi nội dung kiểm của test nào.

## Không làm / Chạm

Không đổi logic sản phẩm, không DLC, không -Exclusive, không đổi số slot/CPU của evotest. Chạm: tools/scripts (wave-*, verify-wave, test-e2e-par.rules, test-int-par.*, test-affected.server.*), `tests/acceptance/H2b/_h2b.ts` (helper).

## Test tối thiểu

`bun test tools/scripts/src/wave-plan.test.ts` (thuật toán chia slot, mảnh, gom thời lượng, đo file theo header) + các test cũ của test-e2e-par / test-int-par / test-affected.server.

## Quyết định trong lúc làm

- Lượt đo thật `verify:wave` sau khi sửa (7 slot trống, 2026-11-06 00:10): wall **900 s** (trước 893 s) — KHÔNG cải thiện dù thùng đã cân (int 290–311 s, e2e 403–587 s). Mô hình đầu (int 2 worker ×1,6; e2e 2 làn; dự kiến 480 s) sai: máy chủ 12 lõi bị bão hoà khi 7 slot cùng chạy, tổng thời gian ca e2e tăng 2598 → 3988 s (+53%) và tổng giây-slot 4143 → 4998 (thêm ≈ 13 lần dựng stack do chia mảnh). Cân thùng không thêm CPU ⇒ không rút được wall.
- Hệ quả: (a) int `-Workers 2` chỉ thêm tải, không nhanh hơn và sinh 3 đỏ mới phụ thuộc thời gian (M2/concurrency "< 900 ms mỗi vòng", H2a/async A37 quét orphan, V2-A/perf) ⇒ đặt lại 1 worker (`WAVE.intWorkers = 1`); (b) cache đã nạp số đo lúc tải cao, boot lấy trung bình mảnh, mảnh tối thiểu 70 s test; (c) `--plan` với cache mới dự kiến 15,8 phút (7 slot) / 14,1 phút (8 slot) — khớp thực tế 15 phút.
- Muốn ≤ 6 phút phải giảm CPU: (1) tổng ca e2e ≈ 2600 s xanh (cần bớt dựng stack lặp lại mỗi việc: 18 việc × 25–50 s; gộp các việc nhỏ dùng chung stack), (2) int ≈ 1700 s (rls-packs 58 s, lock-order, migrate-hub, N1/migrate là công việc thật, không ngủ), (3) bớt ca đỏ có sẵn (≈ 35 đỏ mới/lượt tốn ≥ 8 s mỗi ca), hoặc thêm lõi cho máy chủ evotest. Đây là việc ngoài phạm vi lát hạ tầng chia slot.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: hạ tầng chạy test, không đổi hành vi sản phẩm; chỉ đổi cách chia slot cổng đợt, đo thời lượng file int và bỏ chờ 5 s ở helper afterEach của test)

## Việc còn lại

- Mục tiêu wall ≤ 6 phút / slot ≤ 5 phút CHƯA đạt (thật: 900 s, slot 290–587 s). Cần lát giảm CPU (xem Quyết định): gộp dựng stack e2e, bớt ca đỏ, hoặc thêm lõi.
- Đỏ mới trong lượt đo (35): phần lớn là đỏ có sẵn của đợt (tenants/app-config/community sidebar/contracts-web scenes…) + 3 int phụ thuộc thời gian dưới tải (M2/concurrency, H2a/async A37, V2-A/perf) — chưa chạy lại riêng từng ca.
- Các test int dài do công việc thật (rls-packs 58 s, command-file, migrate-hub, N1/migrate) chưa phải chờ ngủ: cần lát riêng nếu muốn giảm tiếp.
