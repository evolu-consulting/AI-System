# Tasks HD3 (một agent, làn đầy đủ cho phần cao)

| # | Task | Làn / Rủi ro | Test (viết trước nếu cao) | Xong |
|---|---|---|---|---|
| T1 | Engine: `use_current` của người bắt đầu ở stage `exclude_starter` ⇒ 403 (D3-07) | đầy đủ / cao | `processes/domain/tasks/hd3-decision.rules.test.ts`; AC34a ở `tests/acceptance/HD3/flow.int.test.ts` | [ ] |
| T2 | Engine: `PackToolCtx.processRunId`, `AgentTask.noTools`, `PackRuns.{ensureDef,agent,approval,act,outcomesOf}` | đầy đủ / cao | `HD3/flow.int` (AC31–34), `HD3/isolation.int` (AC34c/f/g) | [ ] |
| T3 | Gói: luật def + tool `contracts-extract/value/finalize` (D3-03) | đầy đủ / cao | `contracts/domain/approval-def.rules.test.ts`, `HD3/isolation.int` | [ ] |
| T4 | Gói: starter flow + `/approval` GET/POST + `/extract`/`/manual` chế độ flow | đầy đủ / cao | `HD3/flow.int` | [ ] |
| T5 | Quét (D3-09) + trần tần suất (D3-10) | đầy đủ / cao + perf | `HD3/sweep.int`, `HD3/sweep.perf.int`, unit counter | [ ] |
| T6 | contracts-web S05 thẻ duyệt: "Xác nhận" (cấp 1), "Duyệt" (cấp 2), "Từ chối" (hộp "Lý do từ chối", lỗi "Vui lòng nhập lý do từ chối."), "Trích lại"; `can_act=false` ⇒ "Bạn không thể duyệt bước này."; toast "Đã xác nhận hợp đồng." / "Đã duyệt hợp đồng." / "Đã từ chối hợp đồng."; nhãn "Đã duyệt"/"Bị từ chối" | nhanh / thường | unit lib, e2e `e2e/contracts-web/hd3-flow.cw.ts`, cảnh S05 bỏ ẩn "Xác nhận" | [ ] |
| T7 | chat-web: nút Từ chối ở `ReviewTaskCard` + nhãn `STARTER_CANNOT_REVIEW`; 429 dùng `details.max` | nhanh / thường | unit + e2e chat | [ ] |

FR → test: HD-FR-31 `flow.int` AC31a/b · HD-FR-32 `flow.int` AC32a, `isolation.int` AC32b · HD-FR-33 `flow.int` AC33a–c · HD-FR-34 `flow.int` AC34a/b/d/e, `isolation.int` AC34c/f/g, unit T1 · HD-FR-35 `sweep.int`, `sweep.perf.int`, `flow.int` AC35a · HD-FR-36 e2e.
