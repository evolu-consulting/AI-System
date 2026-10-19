# Tasks · N2-engine-ext

Một agent làm trọn lát (CLAUDE.md Luật 1b, CR-094 đợt 2). Rủi ro **cao** ⇒ làn đầy đủ: readiness 1 vòng, test quyền/tenant/engine viết trước code, reviewer + security review sau.

| # | Task | Làn | Rủi ro | Đọc | File chính | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|
| T1 | spec/plan/tasks + readiness 1 vòng | đầy đủ | cao | `intake-hd.md` N2, `ket-luan-pd2.md`, `N1 ket-luan.md` | `docs/specs/N2-engine-ext/*` | `readiness.md` | [x] NOT READY → áp mặc định 4 Cao (readiness.md) ⇒ READY |
| T2 | Test trước: `tests/acceptance/N2/**` (AC01–AC13) | đầy đủ | cao | spec §2 | `tests/acceptance/N2/**` | đỏ đúng lý do | [x] đỏ ở `needRunsMax`/`needReject`/`needPkRun`/expect trước code (feae3775) |
| T3 | N2-FR-02 contract + luật + gate Từ chối, migration hub 0041 | đầy đủ | cao | plan §3 | `packages/contracts/src/chat/*`, `processes/{gates,domain}/**`, `migrations-hub/0041*` | `reject.int` | [x] 42767d4f, 48571f97 |
| T4 | N2-FR-05 `exclude_starter` (contract, luật, gate, can_act) | đầy đủ | cao | plan §6 | `hub-admin/processes.ts`, `processes/{gates,domain,core}/**` | `starter.int` | [x] 42767d4f |
| T5 | N2-FR-04 trần theo tenant (admin 0013, hub đọc, admin API) | đầy đủ | cao | plan §5 | `migrations/0013*`, `processes/runs/*`, `admin-api/modules/tenants/**` | `cap.int` | [x] e61572f4 (+ `admin-tenant.int`) |
| T6 | N2-FR-01 cổng `PackRuns` + kit + pkdemo route | đầy đủ | cao | plan §1–2 | `processes/runs/start.service.ts`, `packs/kit/**`, `packs/pkdemo/**` | `pack-run.int` | [x] c7dcb639 |
| T7 | N2-FR-03 registry tool gói, stage tool, `/mcp` | đầy đủ | cao | plan §4 | `packs/kit/**`, `processes/adapters/tools/**`, `processes/defs/**`, `mcp/**` | `pack-tool.int` + unit mcp | [x] c7dcb639 |
| T8 | FE admin: ô trần run + checkbox stage; chat-web nhãn `reject` | nhanh | thường | plan §7 | `apps/admin-web/src/features/{tenants,processes}/**`, `packages/i18n/**` | unit FE + typecheck | [x] e61572f4 — e2e admin (readiness #4) chưa làm: nợ |
| T9 | Cổng lát: typecheck, depcruise, unit, int N2/P-d/P-b/N1/HD1, perf d2, check:fn, lock | — | — | brief | — | 0 đỏ ngoài danh sách cho phép | [x] typecheck 12/12; depcruise 0 ca-*/pack-* (3 no-cross-module-repo kh có sẵn); unit 1716/0; int N2+P-d+P-b+N1+HD1 681/0 (121,9 s); check:fn OK; perf d2: P01 p95 10,7 ms (24 câu), P02 5,9 ms, P03 driver 14 câu = trước, P04 p95 34,9 ms đỏ (cho phép, chờ staging), P05 7,3 ms; lock +7 file N2 |

**Đóng 2026-10-19:** [`ket-luan.md`](ket-luan.md); cổng gộp [`wave2-gate.md`](../wave2-gate.md). Còn đỏ: e2e N2 ca trần run (#227), 5 lỗi kiểu test khoá (#228), perf P04 (staging).

## Plan ngắn
Thứ tự T3 → T4 → T5 → T6 → T7 (mỗi bước chạy test N2 tương ứng + test P-d chạm tới), rồi T8, T9. Test khoá P-d chỉ sửa khi contract đổi có chủ ý — ghi từng chỗ ở mục dưới.

## Test khoá P-d phải đổi
Không có. Contract chỉ thêm: mã lỗi mới đặt khối riêng `CHAT_PROCESS_N2_ERRORS` để không đổi khối 13 mã khoá ở P-a/P-b2; `TASK_RESULTS` thêm cuối; `exclude_starter`/`process_runs_max` tuỳ chọn.

## Nợ / việc dở
- e2e admin-web (readiness #4: sửa trần + checkbox exclude_starter) chưa viết — giao qc/frontend-lead.
- chat-web: thông báo 429 vẫn dùng hằng 5 (`PROCESS_RUNS_PER_TENANT`) thay vì trần tenant; nút Từ chối ở chat-web để HD3.
- Tool gói trong `/mcp` chỉ hiện khi agent có khoá trong `payload.mcp.tools` — nối cấu hình agent ở HD6.

## Vòng sửa review + security (2026-10-19)
| Mục | Sửa | Test |
|---|---|---|
| Review Trung #1 | tool gói theo `timeout_s` + `signal` ⇒ `TIMEOUT` (N2-D12) | `pack-tools.registry.test` |
| Review #2/#4, L3 | `ownedRunOutcome` + `GET /items/:id/run`; huỷ bù int | `pack-outcome.int` |
| Review #3 | AC08 đường chạy D2-49 | `pack-tool.int` |
| Review #5 | e2e admin `e2e/N2/` (trần, checkbox) | viết xong; chưa chạy được: `bunx playwright` không nạp config TS trên máy này (`e2e/P-d` lỗi y hệt) |
| Review #7/#8 | assert chặt (my_tasks, 409, reject) | `starter.int`, `reject.int` |
| Review #10 | 429 `details.max` + FE (chat-web, admin-web) | `processes-errors.n2.test` |
| Security M1 | **người dùng chốt 2026-10-19**: decision `redo_limit`/`back_limit` cũng chặn người bắt đầu (N2-D06) | `starter.int` (use_current 403, real_action không chạy, T quyết được) |
| Security M2 | `PackToolDef.action`; `/mcp` + stage (người bắt đầu) kiểm (N2-D13) | registry unit, `pack-tool.int` permission_lost |
| Security L1 | gỡ tool trùng khoá catalog lúc mount; AC09 chờ HD6 (N2-D14) | registry unit |
| Security L2 / Thấp 6 | `orphanCands` ≥ 60 s (N2-D15) | hồi quy P-a/P-d (P1-29 đã đặt `updated_at` -2 phút) |
