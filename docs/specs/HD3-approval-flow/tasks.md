# Tasks HD3 (một agent, làn đầy đủ cho phần cao)

| # | Task | Làn / Rủi ro | Test (viết trước nếu cao) | Xong |
|---|---|---|---|---|
| T1 | Engine: `use_current` của người bắt đầu ở stage `exclude_starter` ⇒ 403 (D3-07) | đầy đủ / cao | `processes/domain/tasks/hd3-decision.rules.test.ts`; AC34a ở `tests/acceptance/HD3/flow.int.test.ts` | [x] |
| T2 | Engine: `PackToolCtx.processRunId`, `AgentTask.noTools`, `PackRuns.{ensureDef,agent,approval,act,outcomesOf}` | đầy đủ / cao | `HD3/flow.int` (AC31–34), `HD3/isolation.int` (AC34c/f/g) | [x] |
| T3 | Gói: luật def + tool `contracts-extract/value/finalize` (D3-03) | đầy đủ / cao | `contracts/domain/approval-def.rules.test.ts`, `HD3/isolation.int` | [x] |
| T4 | Gói: starter flow + `/approval` GET/POST + `/extract`/`/manual` chế độ flow | đầy đủ / cao | `HD3/flow.int` | [x] |
| T5 | Quét (D3-09) + trần tần suất (D3-10) | đầy đủ / cao + perf | `HD3/sweep.int`, `HD3/approval.perf.int`, unit counter | [x] |
| T6 | contracts-web S05 thẻ duyệt: "Xác nhận" (cấp 1), "Duyệt" (cấp 2), "Từ chối" (hộp "Lý do từ chối", lỗi "Vui lòng nhập lý do."), "Đọc lại"; không quyết được ⇒ ghi chú chờ; thông báo "Đã lưu và xác nhận hợp đồng." / "Đã duyệt hợp đồng." / "Đã từ chối hợp đồng."; "Bị từ chối: <lý do>" | nhanh / thường | unit lib, e2e `e2e/contracts-web/hd3-flow.cw.ts`, cảnh S05 bỏ ẩn "Xác nhận" | [x] |
| T7 | chat-web: nút Từ chối ở `ReviewTaskCard` + nhãn `STARTER_CANNOT_REVIEW`; 429 dùng `details.max` | nhanh / thường | unit + e2e chat | [x] |

FR → test: HD-FR-31 `flow.int` AC31a/b · HD-FR-32 `flow.int` AC32a, `isolation.int` AC32b · HD-FR-33 `flow.int` AC33a–c · HD-FR-34 `flow.int` AC34a/b/d/e, `isolation.int` AC34c/f/g, unit T1 · HD-FR-35 `sweep.int`, `sweep.perf.int`, `flow.int` AC35a · HD-FR-36 e2e.

## Kết quả (2026-10-19)
Commit: `f4af4b7a` (spec + test trước + migration gói 0005) · `59dda88e` (BE) · `77cf4f35` (FE + e2e).
Int HD3: flow 10/10, isolation 3/3, starter-decision 2/2, sweep 3/3; hồi quy HD2 + N2 45/45. e2e: contracts-web S05 + hd3-flow 8/8 (+ s05-review ×3, s05-failed so mgmt-app), P-a gate + reject 3/3.
Perf (`PERF=1`, Windows dev, máy đang chạy 4 lát): quét lô 100 p50 3,4 · p95 10,6 · max 14,8 ms (ngưỡng 50); đóng 100 quá hạn một lượt 41,5 ms; `GET approval` p50 5,8 · p95 9,3 · max 20,3 ms (ngưỡng 30).
Nợ mở: D3-04 PDF/ảnh không văn bản qua agent (chép tệp FileBox org tenant sang kho attachment hub). KHÔNG sắp lại `_journal.json` (review m6: drizzle so `when` — đổi sau khi áp sẽ bỏ qua/chạy lại migration).

## Vòng sửa review (2026-10-19)
S1 (hard stop): D3-13 (người dùng chốt mở lại duyệt), D3-14 finalize đọc lại; M1 nhật ký cài đặt (0006); M2 test AC37b, Redis lỗi ⇒ 503 (`action-quota.test.ts`), `processRunId` null (`contracts.tools.test.ts`); m2–m5 sửa (D3-15); m1, m7 ghi spec. Int (`test:int:par tests/acceptance/HD3 tests/acceptance/HD1/patch.int.test.ts`) 46/46 (guard 7/7); HD2 + HD1 detail xanh; RLS gói contracts 91/91; unit gói 193/193. Perf sau sửa: quét lô 100 p50 3,2 · p95 6,1 · max 11,7 ms; đóng 100 quá hạn 24,1 ms; GET approval p95 8,8 ms.
Còn lại (Minor, chưa làm): m8 (a) chèn văn bản khiến agent trả `total_value` thấp — rủi ro còn lại, người duyệt cấp 1 phải kiểm; đề xuất cảnh báo khi `total_value` lệch tổng dòng hàng; (b) agent chọn theo khoá toàn cục, chưa kiểm tenant có quyền dùng agent; m9 S05 tải lại mỗi 2 s khi bước đang chạy (chờ kênh đẩy), chat-web vẫn hiện `use_current` cho người bắt đầu ở decision cấp 2 (bấm ⇒ 403).