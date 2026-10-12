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
