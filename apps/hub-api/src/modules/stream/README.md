# modules/stream — chuyển tiếp `job.delta` (WRK-FR-03)

Spec H2b-routing (R19–R24); plan §1 P11–P13, §5.5; chữ ký hàm thuần `plan-rules.md`.

| File | Vai trò |
|---|---|
| `delta.rules.ts` | thuần: `streamAccept` (loại delta theo vai job), `nextSeqOk`, `reconcileStream` |

Trạng thái: B0 chỉ chữ ký (thân ném `not implemented`). B9: `delta-sink.ts` (gom `S`, cắt ≤ 40 → `delta` SSE).
