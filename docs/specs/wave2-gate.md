# Cổng gộp đợt 2 CR-094 — N2, N3, N5 (+N5b), HD2 (2026-10-19)

Một lượt cổng có bằng chứng cho cả đợt, chạy tuần tự trên nhánh `platform/gd0` (đầu lượt `72313ab3`), máy Windows dev: Postgres 16 + Redis local, **không có docker** trên PATH, bun 1.4.3, Node 22.23.3 (qua `tools/scripts/src/run-playwright.ts`). Số đo là số thật, không làm tròn. Kết luận từng lát: [N2](N2-engine-ext/ket-luan.md) · [N3](N3-notify/ket-luan.md) · [N5 + N5b](N5-identity/ket-luan.md) · [HD2](HD2-extract-verify/ket-luan.md). Đợt 2 **chưa có tệp `*-gate.md` riêng** của từng lát (làn một-agent, Luật 1b) nên không có dòng "Đóng" để thêm.

Sửa trong lượt cổng (ghi rõ phạm vi): `c85b4411` (N5: `check:fn`), `d8a4a54a` (N3 flake bell, `migrate.int` 13→14 main do N2 0013, script `e2e:n1/n2/pd`, lock hàng `bell.cw.ts`). Không sửa test khoá nào ngoài `e2e/contracts-web/bell.cw.ts` (test của chính lát N3, được giao sửa trong brief; lock chỉ đổi hàng đó).

## 1. Cổng tĩnh

| Cổng | Lệnh | Kết quả |
|---|---|---|
| typecheck (gói) | `bunx turbo run typecheck --filter=!@ai/agent-runtime` | **12/12 xanh** (49,8 s). `@ai/agent-runtime` đỏ vì thiếu docker (ENOENT), không thuộc đợt 2 — nợ #230 |
| typecheck (test) | `bunx tsc -p tsconfig.tests.json` | **ĐỎ 5 lỗi TS2769** ở 3 file khoá `tests/acceptance/N2/{pack-tool,reject,pack-outcome}.int.test.ts` (`toEqual([])` trên `RowList`). Test khoá, không sửa — nợ #228 (qc) |
| depcruise | `bun run depcruise` | 0 vi phạm `ca-*`/`pack-*`; **3 lỗi `no-cross-module-repo` cũ** (hub-api `processes`→`kh.writes.repo` ×2, `kh.agent.service`→`agents.repo`) — nợ #226 |
| check:fn | `bun run check:fn` | Trước: 4 vi phạm ở N5 (`reuseOrFail`, `planUsers` 5 tham số; 2 describe test > 50 dòng). **Sửa `c85b4411`** (hành vi không đổi, 26 unit xanh) → `OK (775 file, 4 ngoại lệ allowlist)` |
| check:size | `bun run check:size` | Mã đợt 2: 0 vi phạm. **Đỏ 3 file `reference/mgmt-app-contracts/**`** (642/437/438 dòng, từ GĐ0 `dd56e299`) — nợ #231 |
| i18n:check | `bun run i18n:check` | OK: 1398 + 360 (chat) + 626 (studio) + 181 (contracts) + 1023 (process, 11 phần) key |
| contracts-web build + bundle | `bun run --filter @ai/contracts-web build`; `bun run check:bundle` | Build 0; `check:bundle` turbo **8/8**; admin-web: js 135,7 KB · css 16,7 KB · chunk lớn nhất 39,5 KB |

## 2. Unit và int

| Cổng | Kết quả |
|---|---|
| Unit, mọi workspace (`bun --env-file=.env.local test`) | **4891 pass / 12 fail** (lượt riêng). Không `--env-file`: 4876 / 13 (thêm ca cần `HUB_TEST_DATABASE_URL`). Mười hai ca đỏ **không thuộc đợt 2**: stack test H1/H2a (6, cần stack chạy), `contracts-h2c` R48/R49 (#180), `layers.test` PD-A03 ×3 (trần dòng lớp, vượt từ P-d2), `contracts-pa` R-K01 (`branch` từ P-d2) — nợ #229. Lượt `test:all`: 4890 / 13, ca thứ 13 = `review m-01 · set_config` do **TK1 commit `packages/test-kit` đúng lúc chạy** (không thuộc đợt 2) |
| `test:int:par` toàn bộ (lượt 1) | **3827 pass / 27 fail**, 605,7 s, 421 file / 6 worker. 14 ca timeout 30–60 s (dựng DB mẫu sau khi đổi migration, #208) |
| Chạy lại 20 file đỏ | 181 pass / 12 fail ở 8 file: `migrate-hub` ×4 (#148), `hub-rls` (#176), H2c `upload` A06 / `content` A36 / `send` A47 (#200), `FB1/regress` FB1-AC-03 (Range, cùng nguyên nhân #200), `X2b/context` R08. Toàn bộ chạm hạ tầng/lát cũ, không có file nào của N2/N3/N5/HD2. `N1`, `test-db-template`, `FB1/outputs`, `N2/starter` **xanh khi chạy lại** (chập chờn dưới tải) |
| `test:int:par` đợt 2 + nền (N2, N3, N5, HD2, HD1, N1) | **367 pass / 0 fail**, 36,7 s (31 file) |
| `test:int:par apps/admin-api/src/modules/auth` (riêng, cổng N5b security không chạy được) | **21 pass / 0 fail**, 5,2 s (3 file: `auth.legacy`, `auth.contracts-app`, `auth.service`; file `.perf` tách ở §6) |
| `packages/db/src/migrate.int.test.ts` | Đỏ lượt 1 do N2 0013 (kỳ vọng 13 main); sửa 14 (`d8a4a54a`) → xanh ở lượt `test:all` |

## 3. Migration từ DB trống

`bun run db:migrate` với `DATABASE_URL` trỏ DB mới `ai_wave2_empty` (đã xoá sau đó): `main +14, dev +3, hub +40, hub-dev +1, packs-kit +4, packs +4`, exit 0, 2 s. Hub: 40 migration, thứ tự journal `…0036_pd1_durable (36) → 0037_pd2_tool_branch (37) → 0040_n3_notify (38) → 0041_n2_engine (39)`; `hub.notifications` tồn tại sau migrate. Lần chạy hai trên DB dev có sẵn chỉ áp phần còn thiếu (+1 main, +2 hub, +1 kit, +1 packs), không lỗi.

## 4. e2e

| Cổng | Kết quả |
|---|---|
| `bun run e2e:contracts` ×3 liền | **Trước sửa: 24/25, 3/3 lượt đỏ cùng một ca** `bell.cw.ts` "N3-FR-04 · tùy chọn kênh" (không phải chập chờn). **Sau sửa `d8a4a54a`: 25/25 ×3** (21,0 / 20,5 / 20,4 s) |
| Flake bell — điều tra | `locator.uncheck: Clicking the checkbox did not change its state`. `uncheck()` kiểm trạng thái ngay sau bấm; ô là input controlled cập nhật lạc quan qua react-query (`onMutate` → `setQueryData`, bất đồng bộ) nên DOM bị React đặt lại `checked` trước khi render mới. Nguyên nhân ở test, hành vi sản phẩm đúng (PUT đúng body). Sửa: `click()` + `expect(...).not.toBeChecked()` (assertion tự thử lại, không chờ giờ) |
| e2e admin-web N2 (`bun run e2e:n2`, Node thật) | **1/2** (40 s): ca "exclude_starter" xanh; ca "trần run = 200" **đỏ**: ô múi giờ báo "chưa được hỗ trợ" vì `isSupportedTimeZone` dùng `Intl.supportedValuesOf("timeZone")`, Chromium 153 và Node 22.23 chỉ liệt kê `Asia/Saigon` không phải `Asia/Ho_Chi_Minh` (tenant mặc định VN) ⇒ nút Lưu không gửi PATCH. Lỗi sản phẩm ngoài lát N2 (P-d1 TZ-R02) — nợ #227 |
| e2e P-d (`bun run e2e:pd`) | **21/21** (75 s) |
| e2e N1 (`bun run e2e:n1`) | **29/29** (20,6 s) |
| Playwright TS config | `bunx playwright` không nạp được config TS qua shim node của Bun; chạy được bằng `tools/scripts/src/run-playwright.ts` (Node 22 thật). Đã thêm script `e2e:n1`, `e2e:n2`, `e2e:pd`. `test:all` vẫn gọi `bunx playwright` **và** `Glob.scan` của nó trả **0 cấu hình** trên máy này ⇒ không chạy bước e2e nào — nợ #225 |

## 5. Khoá test

`bun run test:lock:verify`: trước lượt cổng báo CHANGED 4 hàng (`DEVIATIONS.md`, `bell.cw.ts`, `hd2-flow.cw.ts`, `HD2/extract.int.test.ts`; cây làm việc có `tests/.lock` lệch so với HEAD). Sau `test:lock:write` chỉ hàng `e2e/contracts-web/bell.cw.ts` khác HEAD; `test:lock OK (980 file)` và vẫn OK ở cuối `test:all`.

## 6. Perf (`PERF=1`, từng file một, máy rảnh trừ TK1 chen vào cuối)

| Lát | Ca | Số đo | Ngưỡng | Kết |
|---|---|---|---|---|
| N2 (d2) | P01 stage tool (10 stage, 3 tool) | có tool p50 8,0 · p95 12,4 ms; không tool p95 9,5 ms (n=40); 22 câu = 22 câu | — | Đạt (câu tra tool +1) |
| N2 (d2) | P02 | p50 4,7 · p95 8,0 ms, 2 câu | — | Đạt |
| N2 (d2) | P03 driver tool | p50 15,2 · p95 24,6 ms; 63 câu cả cửa sổ (1 vs 20 tham số), 14 vs 14 câu driver | — | Đạt |
| N2 (d2) | **P04 nhánh nhảy 1 vs 7 bước** | p50 21,8 · **p95 50,9 ms** (POST p95 50,8); câu SQL 46 = 46 (mốc 42, khớp 46, không khớp 43) | p95 ≤ 30 ms | **ĐỎ thời gian** (số câu đạt). Đã biết, chờ staging Linux (`ket-luan-pd2.md`); lượt này nặng hơn lượt N2 trước (34,9 ms) |
| N2 (d2) | P05 hẹn | không hẹn 2 câu, 50 hẹn 2 câu; p50 5,4 · p95 6,6 ms (mốc 5,9) | — | Đạt |
| N3 | N3-NFR-01 lô 100, nền 10.000 | ghi cổng p95 5,62 · chia kênh p95 10,08 · nhận p95 4,51 · ghi kết cục p95 3,70 ms (max 51,4 / 61,7 / 6,65 / 4,65); 300 câu/100 lô; 10.000 gửi xong 1,47 s | p95 ≤ 50 ms | Đạt |
| N5 | 10.000 user, lô 500 | dry-run 145 ms (≤ 1 câu/lô, 20 lô); apply 1.950 ms (user 6 câu/lô, lô org 9 câu); chạy lại 1.841 ms (≤ 2 câu/lô) | ≤ 30 s | Đạt |
| N5b | login p95 (n=20) | argon2 sau sunset 41,4 · trước sunset 42,8 · legacy lần đầu 52,6 ms | < 150 ms | Đạt |
| HD2 | `verify` 30.000 ký tự + 50 dòng | p50 1,617 · p95 2,652 · max 3,576 ms | ≤ 5 ms | Đạt |
| HD2 | `verify` Worker 5 MB / 500 dòng | worker 577 ms, nghẽn vòng sự kiện 6,1 ms; tại chỗ 566 ms (nghẽn 566 ms) | không chặn vòng sự kiện | Đạt |

## 7. `bun run test:all` (684 s)

`✗ check` (check:size #231 + depcruise #226; biome 0 lỗi, 16 cảnh báo) · `✗ typecheck` (docker, #230) · `✗ unit` (13, §2) · `✗ int` (3841 pass / 13 fail, 626,5 s: A47, A06, A36, FB1-AC-03, `migrate-hub` ×4, `hub-rls`, X2b R08, I19 đỏ khi chạy cả bộ nhưng xanh khi chạy riêng, P1-48e `apply ∥ sweepOnce` chập chờn chỉ lượt này, 1 timeout 30 s) · `✓ lock` · `✗ python` (docker, #230) · bước e2e: **0 cấu hình** (#225). Đây không phải một lượt xanh; mọi ca đỏ đã phân loại: không có ca nào đỏ do mã N2/N3/N5/HD2 ngoài N2 e2e trần run (#227) và 5 lỗi kiểu test khoá (#228).

## 8. N1 T7 và HD1 T12

Bằng chứng smoke `bun run test:all` đã chuyển về đây (§7) cùng cổng riêng của hai lát: int N1+HD1 xanh (§2, 367/0), e2e N1 29/29, e2e contracts-web 25/25 (gồm hd2/HD1), perf HD1/N1 chưa chạy lại ở lượt này (số Windows dev đã ghi ở `ket-luan.md` của hai lát; đo staging còn chờ). Tick **N1 T7** (đã `[x]`, cập nhật ghi chú) và **HD1 T12** theo yêu cầu điều phối; các ca đỏ còn lại của `test:all` thuộc nợ #225–#231, #208, #148, #176, #180, #200, không thuộc N1/HD1.

## 9. Việc mở sau cổng

| # | Việc | Ai |
|---|---|---|
| #224 | Rate limit đăng nhập admin-api — **điều kiện cứng trước import khách thật HD10**; giữ `LEGACY_HASH_SUNSET` mặc định | backend-lead |
| #227 | `isSupportedTimeZone` chấp nhận alias (đỏ e2e N2) | frontend-lead / backend-lead |
| #228 | 5 lỗi kiểu `tsc` ở test khoá N2 | qc |
| #225, #230, #231 | `test:all` trên máy này (Glob e2e, docker, `reference/`) | qc / điều phối |
| #226, #229 | depcruise cũ; test khoá cũ đỏ | qc / backend-lead |
| #219 | HD2 trích chưa nối run Hub — chuyển HD3 | backend-lead |
| Staging | `deploy/staging/run-spike.ps1 -LoadN 10000`: P04 d2, perf N1/HD1/N3/N5 trên Linux | Người dùng |
