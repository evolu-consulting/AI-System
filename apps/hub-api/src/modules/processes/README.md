# processes — Process Engine P-a + P-b2 (HUB-FR-104…118, 136; HUB-BR-23…28, 38)

Quy trình nhiều giai đoạn chạy agent/nhóm agent, có cổng kiểm của người, hỏi lại, nhờ người khác, token (spec P-process-engine).
Cờ `HUB_PROCESS_ENGINE=on|off` (D15): tắt ⇒ không mount, `!` là chữ thường.

| Thư mục | Chủ | Nội dung |
|---|---|---|
| `processes.mount.ts` | Bước 0 | mount route mọi PF, ThreadPoster + vòng nền, seam N3 (`ProcessHandles`) |
| `core/` | Bước 0 | luật thuần dùng chung (`process-state`, `run-access`, `bang`, `limits`, `task`, `thread`), `task-view`, `thread` + `thread-poster` (outbox tin `process`), `ports` (`ProcessStartPort`, `StageLauncher`, `ProcessNotifier`, `ProcessDeps`), `core.repo`, `events`, `errors`, `clock`, `handles` |
| `defs/` | B3 (0c) | `/process-defs*`, `GET /agent-teams` |
| `runs/`, `gates/` | PF1 | start (phòng/Hỏi AI/nút), stage driver, team-runner, launcher, sweeps, view, cancel/decide, cổng kiểm |
| `asks/` | PF2 | answer/forward |
| `notify/` | PF3 | notifier, inbox, reminder |
| `usage/` | PF4 | `GET /process-runs/:id/usage` |

Điểm vào từ module khác: `rooms/messages/messages.service.ts` (`useProcesses`, T7), `runs/runs.routes.ts` (`!` Hỏi AI, D14),
`runs/create-run.ts` (`CreateRunInput.process`), `runs/runs.service.ts` (`prepareProcess`, D3).
Thứ tự khoá: plan §10. PF gọi nhau chỉ qua `core/ports.ts`; tin thread chỉ qua `enqueueThread` + `postThread` sau COMMIT.

**P-b2** (bước song song, quay lại, Bàn giao; migration `0024_pb2_steps`, `0025` FK kép):
- Bước/join: `runs/step-persist.ts` (lưu `process_steps`), `core/step.rules.ts` (luật thuần: bước hiện tại, join mọi stage Đạt, `real_action`); `runs/view-steps.ts` dựng bước cho view.
- Quay lại: `gates/back.rules.ts` + `back.effects.ts`, bảng `process_back_events`, trần `back_limit` ≤ 3 vòng.
- Huỷ `hub.runs` (scope system) **sau COMMIT**: `cancelStageRuns`/`cancelRunsByIds` — RLS `runs_hub_rw` chỉ cho chủ run.
- Launcher: `runs/launcher-step.ts` (chọn stage chạy), `launcher-session.ts` + `session.rules.ts` (resume Claude, tuổi ≤ 86400 s), `handoff.rules.ts` (`## Bàn giao` ≤ 200 token, cắt không từ chối).
- Bẫy: stage key regex lệch contract (TECH-DEBT #150); `defs/def.rules.ts` import `runs/template.rules` (#151).

**P-c1 Tự-sửa mã** (HUB-FR-119, 126…130; migration `0031_pc_autofix`; spec `docs/specs/P-c-autofix/`):
- `runs/autofix.rules.ts` (luật thuần: `autofixDecisionOptions`, `autofixOutcome`, `basePatchOf`, `autofixRetryNote`, `allowlistUnion` nhánh autofix); `runs/autofix.repo.ts` (`stageJobExtras` dựng `payload.autofix`, truy vấn kết quả); `runs/view-autofix.ts` (HUB-FR-128: `StageView.autofix`, chỉ view `full`/stage của người duyệt).
- Quyết định `autofix_*`: chỉ `add_attempt`/`cancel` (`use_current` ⇒ 409). Ngoài thư mục này: `internal/autofix.*` (nhận báo cáo Runtime), `attachments/autofix-files*` (đọc diff/log theo quyền xem run, PC-R14), seed `fixbug-apply`.
- Bẫy: `TaskDetail.options` lệch `FORCE_USE_CURRENT` (TD-168); vòng "k" đếm cả lần thử lại do template.

**P-c2 Mở PR (stage Áp)** (HUB-FR-129; migration `0032`; spec `docs/specs/P-c2-pr/`):
- Stage `apply` (`executor: {kind: "apply"}`, `real_action`, `after: auto`) đứng ngay sau stage tự-sửa; mẫu seed `fixbug-pr` (tắt sẵn, `fixbug-apply` P-c1 giữ nguyên). Luật thuần: `defs/def.rules.ts` (`applyStageIssues`), `runs/apply.rules.ts`; `runs/apply-launch.ts` (job `source.apply`), `runs/apply-driver.ts` + `apply-settle.ts` + `adapters/runs/hub-settle.ts` (`writeApplyOutput`, `settleApply`; T18s) (gọi GitHub ngoài tx qua `github-client`, output `apply.md` inline), `runs/view-apply.ts` (`ApplyStageView`). Driver chỉ chạy từ `sweepOnce` (`advanceApplies`), không hook từ kênh `apply-result` (tránh đua gọi provider).
- Hai kênh nội bộ (Bearer token job, `internal/`): `POST /internal/jobs/:job_id/source-credential` (giao khoá nguồn một lần cho Runtime push, `source-credential.*`) và `POST /internal/jobs/:job_id/apply-result` (Runtime báo kết quả đẩy nhánh, `apply.*`). Diff `patch` tải qua `GET /internal/jobs/:id/attachments/:attId` (nhánh `source.apply`).
- Quyết định `apply_*` (xem `autofixDecisionOptions`); `error_code` luôn có khi stage failed/check_failed. Chi tiết quyết định: `docs/specs/P-c2-pr/spec-decisions.md` (D24–D30).
