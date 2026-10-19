# Tasks · N2-engine-ext

Một agent làm trọn lát (CLAUDE.md Luật 1b, CR-094 đợt 2). Rủi ro **cao** ⇒ làn đầy đủ: readiness 1 vòng, test quyền/tenant/engine viết trước code, reviewer + security review sau.

| # | Task | Làn | Rủi ro | Đọc | File chính | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|
| T1 | spec/plan/tasks + readiness 1 vòng | đầy đủ | cao | `intake-hd.md` N2, `ket-luan-pd2.md`, `N1 ket-luan.md` | `docs/specs/N2-engine-ext/*` | `readiness.md` | [ ] |
| T2 | Test trước: `tests/acceptance/N2/**` (AC01–AC13) | đầy đủ | cao | spec §2 | `tests/acceptance/N2/**` | đỏ đúng lý do | [ ] |
| T3 | N2-FR-02 contract + luật + gate Từ chối, migration hub 0041 | đầy đủ | cao | plan §3 | `packages/contracts/src/chat/*`, `processes/{gates,domain}/**`, `migrations-hub/0041*` | `reject.int` | [ ] |
| T4 | N2-FR-05 `exclude_starter` (contract, luật, gate, can_act) | đầy đủ | cao | plan §6 | `hub-admin/processes.ts`, `processes/{gates,domain,core}/**` | `starter.int` | [ ] |
| T5 | N2-FR-04 trần theo tenant (admin 0013, hub đọc, admin API) | đầy đủ | cao | plan §5 | `migrations/0013*`, `processes/runs/*`, `admin-api/modules/tenants/**` | `cap.int` | [ ] |
| T6 | N2-FR-01 cổng `PackRuns` + kit + pkdemo route | đầy đủ | cao | plan §1–2 | `processes/runs/start.service.ts`, `packs/kit/**`, `packs/pkdemo/**` | `pack-run.int` | [ ] |
| T7 | N2-FR-03 registry tool gói, stage tool, `/mcp` | đầy đủ | cao | plan §4 | `packs/kit/**`, `processes/adapters/tools/**`, `processes/defs/**`, `mcp/**` | `pack-tool.int` + unit mcp | [ ] |
| T8 | FE admin: ô trần run + checkbox stage; chat-web nhãn `reject` | nhanh | thường | plan §7 | `apps/admin-web/src/features/{tenants,processes}/**`, `packages/i18n/**` | unit FE + typecheck | [ ] |
| T9 | Cổng lát: typecheck, depcruise, unit, int N2/P-d/P-b/N1/HD1, perf d2, check:fn, lock | — | — | brief | — | 0 đỏ ngoài danh sách cho phép | [ ] |

## Plan ngắn
Thứ tự T3 → T4 → T5 → T6 → T7 (mỗi bước chạy test N2 tương ứng + test P-d chạm tới), rồi T8, T9. Test khoá P-d chỉ sửa khi contract đổi có chủ ý — ghi từng chỗ ở mục dưới.

## Test khoá P-d phải đổi
(cập nhật khi làm)
