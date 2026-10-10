# processes — Process Engine P-a (HUB-FR-104…117, HUB-BR-23…28)

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
