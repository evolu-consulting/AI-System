---
id: tool-evotest-cache
lát: tool-evotest-cache
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Rút thời gian chạy đầy đủ trên evotest (int 34 phút, e2e 50 phút ở -Slots 6) bằng hạ tầng test, không đổi sản phẩm:
1. **Dựng web một lần mỗi khoá.** Script `build` của 5 app web (`chat/admin/sohoptac/community/studio-web`) gọi `tools/scripts/src/evotest-cache.ts app-build`
   (không sửa cấu hình Playwright: `bun run --filter @ai/x build` trong webServer tự đi qua). Có `EVO_BUILD_CACHE` (evotest: `/cache/build`, volume dùng chung mọi slot)
   thì khoá = gói + định danh mã nguồn (`c-<commit>` khi sạch; `h-<băm nội dung>` khi `-Dirty`) + băm `bun.lock` + bản bun + `PUBLIC_*`/`NODE_ENV`;
   hụt ⇒ đúng MỘT lượt dựng dưới khoá thư mục có nhịp tim (lượt khác chờ), thành phẩm vào bằng rename nguyên tử; trúng ⇒ chép `dist` vào `E2E_DIST_DIR` của việc.
   Không đặt biến ⇒ chạy `rsbuild build` như cũ (local/CI không đổi).
2. **Mẫu DB đã migrate dùng chung giữa slot.** pg của mỗi slot nằm ở tmpfs, mất sau lượt ⇒ `cache.sh dbtpl_save` (cuối bước int) `pg_dump -Fc` các mẫu `…_tpl_test`
   (+ role) vào `cache/dbtpl/<băm migrations>/`; `dbtpl_restore` (đầu bước int, slot mới) nạp lại thành `ai_system_cache_<key>_tpl_test` với COMMENT `key:băm`
   ⇒ `ensureTemplate` coi là donor và worker chép bằng `CREATE DATABASE … TEMPLATE` (đã có sẵn) thay vì migrate. COMMENT trong DB là chuẩn: băm lệch ⇒ migrate như cũ.
3. **Chặn lượt toàn bộ.** Lượt toàn bộ (`-Step int|e2e|all` không `-Filter`) từ chối (exit 5) khi slot khác còn bận, trừ `-Force`; trong lúc chạy giữ `.exclusive`
   (owner trường 5 = `full`) nên lượt thường xếp hàng. Dùng lại luật khoá CR-115 (`lock.sh full_acquire`, `boot.sh`).
4. **Dọn cache.** `cache_prune` (cuối mỗi lượt + `run-tests.ps1 -CachePrune [-Keep 5] [-MaxGb 6]`): giữ N ref dùng gần nhất mỗi pool + trần dung lượng, không xoá mục mới sửa (< 10 phút).

5. **Chia slot cho lượt toàn bộ (điều phối bổ sung).** `run-tests.ps1 -Step e2e|all` (không `-Filter`) chia: int một slot (workers = lõi), việc e2e cho các slot trống còn lại (LPT theo `cache/e2e-timings.json`),
   chạy song song bằng tiến trình con `-InShard`, tóm tắt gộp. `-Jobs`/`-Cpus`/`-Slots ≤ 12`/`--workers ≤ 12`; `community-web` cổng riêng 3470.
6. **Fail-fast stack e2e.** `tools/scripts/src/e2e-failfast.ts` (preload qua `BUN_OPTIONS` của `test-e2e-par`): stack `e2e/**/_*.ts` thoát ngay khi tiến trình con chết bất thường (không sửa file stack đã khoá).
7. In cuối lượt: việc e2e chậm nhất + 10 file int chậm nhất.

## Làm
- [x] chia slot: `evotest-shard.{rules,ts}` + `run-tests.ps1` + `in-container.sh` (thời lượng) + compose `EVO_RUNNER_CPUS/MEM`, `EVO_JOBS`
- [x] `e2e-failfast.ts` + `test-e2e-par.ts --list/--timings`, `test-int-par.ts` top-10, `MAX_WORKERS 12`, META `community-web`
- [x] `tools/scripts/src/evotest-cache.{rules,lib}.ts` + `evotest-cache.ts` (CLI) + `evotest-cache.test.ts` (unit)
- [x] 5 `apps/*-web/package.json`: script `build`
- [x] `deploy/evotest/{cache.sh,lock.sh,boot.sh,remote.sh,in-container.sh,docker-compose.yml,run-tests.ps1}`
- [x] `evotest-cache.int.test.ts` + mở rộng `evotest-lock.int.test.ts` (bash thật, chạy trên evotest)
- [x] `docs/WORKFLOW.md` mục evotest

## Không làm / Chạm
Không đổi mã sản phẩm, không sửa cấu hình Playwright/e2e/tests khoá. Không cache DB cho e2e (các stack e2e tự `resetTestDb` + migrate trên DB rỗng; chia sẻ mẫu cần sửa từng `_stack`).

## Test tối thiểu
unit (khoá/ref/khoá thư mục/dựng một lần/kế hoạch xoá) + int bash thật (full_acquire, boot.sh full, cache_prune, băm migrations khớp `migrationsHash`) + đo trước/sau trên evotest.

## Quyết định trong lúc làm
- Chặn cache dựng KHÔNG sửa cấu hình Playwright và KHÔNG sửa `package.json` của repo: `in-container.sh` chạy `evotest-cache.ts patch-build-scripts` trên bản sao tạm (prod Docker/local giữ `rsbuild build`, có test).`n- Chia slot theo ngân sách đồng thời lõi × 1,3 (int workers + ngăn e2e × việc cùng lúc); việc dư xếp hàng trong ngăn.
- Khoá cache dùng nhịp tim (không PID) vì nhiều container (PID namespace khác nhau) cùng ghi `/cache`.
- Biến URL/cổng (`HUB_URL`, `ADMIN_API_URL`…) không vào khoá (chỉ dùng lúc preview); `PUBLIC_*` có vào (rsbuild nhúng vào bundle).
- Lượt toàn bộ = int|e2e|all không `-Filter` (kể cả không `-All`): mới đúng ý "một lượt giữ cả máy chủ".

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: không thay đổi hành vi sản phẩm — chỉ hạ tầng test/evotest: cache dựng, mẫu DB, khoá lượt toàn bộ; không đổi mã sản phẩm nào).

## Việc còn lại
Xem báo cáo cuối lát (số đo trước/sau, e2e DB chưa dùng mẫu).
