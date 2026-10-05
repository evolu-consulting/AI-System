# modules/stream — chuyển tiếp `job.delta` (WRK-FR-03)

Spec H2b-routing (R19–R24); plan §1 P11–P13, §5.5; chữ ký hàm thuần `plan-rules.md`.

| File | Vai trò |
|---|---|
| `delta.rules.ts` | thuần: `streamAccept` (loại delta theo vai job), `nextSeqOk`, `reconcileStream`, `chunkDelta` (≤ 40 đơn vị UTF-16) |
| `delta-sink.ts` | `DeltaSink` (một per job được stream): kiểm `seq` liền mạch, lọc `accept`, phát SSE `delta`, gom S |
| `stream-trace.ts` | trace `run_steps.detail.stream` (`delta_gap`/`delta_mismatch`/`stream_unparsed`; nhãn sau cùng) + `detail.streams` (mọi nhãn) + log `warn` |
| `stream.repo.ts` | SQL gộp `detail` của step |

Luồng: driver (`orchestrator.service`, `mention/direct-driver`) tạo sink → `AgentTask.stream` → `runJob` đưa mọi sự kiện
không kết thúc của job vào sink → `JobOutcome.streamed/gap/stepId` → vòng/driver đối chiếu `reconcileStream`, phát phần
còn lại, ghi trace rồi `finish`. `DifyAgentRunner` phát `job.delta` tổng hợp khi `task.stream` (P14).
