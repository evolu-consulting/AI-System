# P-d-durable · plan frontend P-d2 (T14 · T20) — Gọi tool, Rẽ nhánh, tab Tool quy trình [HUB-FR-146, 147][ADM-FR-73]

Phần của [`plan-frontend.md`](plan-frontend.md) (§0 quyết định FD, §5 domain, §6 mã lỗi, §14–§15; số mục §10–§13 giữ nguyên để trỏ). Spec: [`spec-d2.md`](spec-d2.md) §6, [`spec-tz-tools.md`](spec-tz-tools.md) §2 · contract: [`plan-contract.md`](plan-contract.md) §4, §6 (`ArgSource`, `BranchRule`, `ProcessToolItem`) · backend: [`plan-d2.md`](plan-d2.md) §4, §7 · câu chữ: [`plan-frontend-i18n.md`](plan-frontend-i18n.md) §4 · mockup `04` (E1–E4), `02` (C1–C5). Quyết định FE: `spec-decisions.md` D2-19…D2-23. **BUILD:** T17 + T18a xong, FE ở T20. Mockup đã duyệt thắng plan-d2 khi lệch (xem §10 "Lệch").

## 10. Admin · panel "Gọi tool" + "Rẽ nhánh" + canvas (mockup 04)
**Code thật (`apps/admin-web/src/features/processes`):** `StageDraft.executor` là chuỗi `agent:<id>|team:<id>|apply|wait_until`; kiểu đặc biệt tách khỏi form chung bằng `isWait`/`isApply` trong `StageForm` (nhánh loại trừ). `def-form.ts` 336/400 dòng, `StageOutput.tsx` 206 và `ProcessCanvas.tsx` 209 (đã quá 200) ⇒ **không thêm dòng vào ba file này**; logic mới vào file mới, file cũ chỉ thêm lời gọi.

**Draft + hàm thuần (file mới `lib/`)**
| File | Nội dung |
|---|---|
| `draft-types.ts` (+≈8 dòng) | `StageDraft.tool: ToolDraft = { key: string; args: Record<string, { from: "const"\|"input"\|"field"; value: string }> }`; `StageDraft.branch: BranchDraft[] = { field; op; value; goto: number\|null }`; `emptyTool()`, `emptyBranch()` |
| `tool-form.ts` | `TOOL_EXECUTOR="tool"`, `isTool`, `TOOL_PATCH` (`after` giữ tuỳ chọn), `normalizeTool(s)` (khuôn `normalizeWait`: ép `answerer:starter`, `sources:[]`, `mustKnow:""`, `autofix` rỗng, `budget:""`, `template/sections` ép `["Kết quả","Bàn giao"]`; giữ `fields`, `filename`, `timeout`; bỏ `args` không còn trong tool), `toolToExecutor`/`executorToTool`, `toolIssues(tool, def, stageFields, step)` live (cùng luật `plan-d2-rules`) |
| `branch-form.ts` | `branchToRules`/`rulesToBranch` (UI đếm bước từ 1 ⇒ `goto_step = goto-1`), `branchIssues`, `branchErrorAt(errors,i)` (path server `stages.i.after.branch.j.*`) |
| `domain/tool-rules.ts`, `domain/branch-rules.ts` | `paramCompatible(sourceType, paramType)` ([rules §2](plan-d2-rules.md), cùng ma trận BE, D2-29; const gửi đúng kiểu param, kiểu `number` dùng `type=number`), `missingRequiredArgs`, `isFileParam`; `opsForType`, `branchRuleIssues`, `isStandalone(stages,i)`, `branchEdges(stages)` — thuần `{key,type}` như `wait-rules.ts`; mã lỗi vào `domain/error-keys.ts` (`TOOL_INVALID`, `TOOL_SIDE_EFFECT`, `BRANCH_INVALID`, ref tool) |
| `def-form.ts` | chỉ thêm: `normalizeTool` ở nơi gọi `normalizeWait`; chuyển `executor`/`after.branch` hai chiều gọi sang `tool-form`/`branch-form`; `validateStage` (`stage-validate.ts`, 54 dòng) gọi `toolIssues`/`branchIssues` |

**Dữ liệu catalog (D2-20):** không route mới. `api.ts` đã có `useProcessEditorContext` (`GET /process-editor/context`, `tools` hiện là `unknown` — T17 đổi sang `ProcessToolItem`); hook mới `hooks/use-process-tools.ts` bọc cùng query (cùng khoá cache với `use-process-timezone` ⇒ một request) trả `{ tools, isPending, isError, refetch, isTemplate }`. Tenant `undefined` (mẫu) ⇒ `tools=[]` và `isTemplate`.

**"Gọi tool"** — `components/editor/StageTool.tsx` (≤ 140 dòng) + `ToolArgRow.tsx` (≤ 120) , `fieldset aria-label="Gọi tool"`. `StageForm` thêm nhánh `isTool(stage) ? <StageTool/> : …` cạnh `isWait`; `StageGeneral` thêm option "Gọi tool" vào `SelectField "Người thực hiện"` (khuôn `WAIT_EXECUTOR`; `disabled` + chữ phụ khi mẫu, ẩn "Hướng dẫn" như wait). **Lazy:** `StageTool` nạp bằng `lazy()` (chỉ cần khi chọn tool) trong `StageForm`.
| Thành phần | Chi tiết |
|---|---|
| Tool | `SelectField "Tool"`, option `"{name} · {key}"`, chỉ tool **khả dụng** (đã bật cho công ty ∧ workflow `enabled`; BE lọc, FE không lọc lại). Tool có tham số `file` ⇒ option `disabled` + "Tham số tệp chưa dùng được…". Giá trị đang chọn nhưng đã mất khỏi catalog ⇒ `withCurrent(..., "(không còn)")` + lỗi ref (`tool.err.ref`) |
| Huy hiệu | `Badge warn "Tác dụng phụ"`; chọn tool `side_effect` ⇒ `real:true` **nếu** `canRealAction`; không thì lỗi live `TOOL_SIDE_EFFECT`. `StageGate` vẫn hiện (không ép `after`) |
| Bản đồ tham số | mỗi param một thẻ: tên mono + `*` (`aria-label="bắt buộc"`) + kiểu + mô tả; `Select "Nguồn của tham số {name}"` (`Giá trị cố định`·`Thông tin đầu vào`·`Kết quả giai đoạn trước`) + control: `const` ⇒ `TextField` (`type=number` khi number); `input` ⇒ `Select` input quy trình; `field` ⇒ `Select` trường của stage ở **bước nhỏ hơn** lọc `paramCompatible` (nhãn `Giai đoạn {n} · {field}`). ≤ 20 param. Không nhập thiếu bắt buộc ⇒ `tool.err.argRequired` |
| Kết quả | `OutputFields.tsx` **mới** (tách `Fields` khỏi `StageOutput`, D2-22; `StageOutput` import lại) + ô `filename` + `timeout_s` (`StageLimits`); Hub sinh .md |
| Ẩn | Hướng dẫn, nguồn, tự sửa mã, người trả lời, "Điều phải biết", ngân sách, mẫu tệp + mục (A3) |
| Trạng thái | `isPending` ("Đang tải tool…", select disabled) · `isError` ("Không tải được danh sách tool." + nút Thử lại) · rỗng ("Chưa có tool nào được bật cho công ty — liên hệ quản trị nền tảng") · mẫu (`tool.template`) |

**"Rẽ nhánh"** — `StageBranch.tsx` (≤ 150) + `BranchRuleRow.tsx` (≤ 110), `fieldset aria-label="Rẽ nhánh"`, đặt trong `StageForm` ngay sau `<StageGate/>` (cả `after` review/auto; không áp wait/apply). Hàng luật 5 cột: `combobox "Nếu trường"` (= `stage.fields`, nhãn `key (Kiểu)` — nhãn kiểu dùng lại `process.admin.editor.stage.type.*` sẵn có "Chuỗi/Số/Ngày") · `combobox "Phép so sánh"` (`opsForType`) · `Giá trị` (`TextField` — cần thêm `type:"date"` vào `Fields.tsx`, +3 dòng) · `combobox "Thì tới bước"` (bước `> step`, `Bước n`) · `button "Xoá luật {n}"`; `button "Thêm luật rẽ nhánh"` (ẩn khi đủ 10; ghi "Tối đa 10 luật."). **Khoá** (`fieldset disabled` + `Alert role="status"` `branch.locked`) khi `!isStandalone`; không có `fields` ⇒ `branch.noFields`. Đích có `real` ⇒ lỗi live `branch.err.real`. Draft mặc định `branch: []`. **Lệch bước:** đổi/xoá/chèn bước (`step-ops.ts`) không tự sửa `goto` — theo cách `backTo` đang xử lý; luật có `goto ≤ step` hiện lỗi live `branch.err.goto` (Q-T14-2).

**Canvas (nét đứt)** — `lib/canvas-layout.ts` (98 dòng): `LayoutStage` thêm `branch: { goto: number|null }[]`; `LayoutEdge.kind` thêm `"branch"` + `label`/`rule`; cạnh từ uid stage nguồn tới `headerId(goto)`, một cạnh mỗi luật (id `uid>hN#k`). **`canvas-edges.ts` mới** (tách `toEdge` khỏi `ProcessCanvas.tsx` để file không tăng), `BranchEdge.tsx` mới (≤ 50, theo `BackEdge.tsx` 36 dòng: nét đứt `stroke-dasharray`, màu `--color-primary`, nhãn "Rẽ nhánh · luật n", `markerEnd` ArrowClosed, `edgesFocusable=false`); `edgeTypes = { back, branch }`. `BackEdge` giữ nét đứt `--color-warning` đi ngược ⇒ phân biệt bằng màu + nhãn. `StageView` thêm `tool: boolean`, `sideEffect: boolean`, `branch: number` (số luật); `sameView` so thêm (memo). `StageBody` (82 dòng): huy hiệu `info "Gọi tool"`, `warn "Tác dụng phụ"`, `info "Rẽ nhánh · n luật"` (chỉ thêm ≈ 14 dòng, vẫn ≤ 200). `executor` của tool = **tên tool** (mockup E1). `StepList.tsx` (96): dòng `canvas.list.branch` "Rẽ nhánh: luật n tới bước m" (đường bàn phím/a11y).**Lệch plan-d2 ↔ mockup:** không lệch hành vi; mockup E1/E4 hiện tên tool ở dòng executor/"Làm bởi" ⇒ theo mockup (D2-23).

## 11. Chat-web · P-d2 (ngân sách 141/150 KB — xem §14)
Code P-d1 thật đã có: `stageStatusKey("skipped")`, `process.common.stage.skipped` ("Bỏ qua"), `StageStrip` nhánh `waitDetail` `case "skipped"` (chữ + gạch ngang, `DOT` rơi về `bg-border`), `domain/stage-wait.ts#describeStageWait` coi `status==="skipped"` thắng. ⇒ **"Bỏ qua" gần như không cần mã mới**: chỉ bỏ ép kiểu `StageRunStatus | "skipped"` ở `status.ts` khi T17 thêm `skipped` vào enum contract, và `StageStatus`/`stage-label` admin đã có. Việc còn lại:
| Việc | File | Chi tiết |
|---|---|---|
| Lý do `tool_failed` | `shared/lib/decision-reason.ts` (33 dòng) + i18n `process.common.tool_failed` + `tool_failed_hint` (đã có ở i18n §0; `reasonKey` = `process.common.${reason}`; thêm `tool_failed` vào `reasonHintKey`) | "Gọi tool bị lỗi." + hint hướng dẫn thử lại/huỷ; nhãn nút mặc định; `useCurrentDisabled` sẵn có xử lý `use_current` |
| Tin rẽ nhánh | `shared/thread/BranchMessage.tsx` **mới** (≤ 30 dòng, `lazy` như 7 kiểu còn lại trong `ProcessThreadMessage.tsx` + 1 `case "branch"`) | "Rẽ nhánh: tới bước {{step}} (luật {{rule}})", `step = to_step + 1`, `<p data-seq>` giống nhánh `default` |
| Nhật ký Run | `run-page/components/LogTab.tsx` + `HistoryItem.kind="branch"` | cùng câu (`inbox.run.log.branch`) |
| Dòng bước bị nhảy | `run-page/components/StageRow.tsx` | trạng thái `skipped` ⇒ "Bỏ qua" (lấy từ `stageStatusKey`); mục "Làm bởi" của stage tool = tên tool (`tool_key` → `StageView.tool_key`) |

## 12. Admin · tab "Tool quy trình" (ADM-FR-73; mockup 02 C1–C5)
Code thật: `TenantDetailPage.tsx` 171 dòng, `type TenantTab = "info"|"features"|"agents"|"quota"|"users"` + `TABS` ở `routes/_authed/tenants/$tenantId.tsx`; các tab tách `TabsContent`; tab Quota đã có mẫu danh sách + `ConfirmDialog` + dirty-guard. **Tab này không có form ⇒ không `UnsavedGuard`.**
| File | Nội dung |
|---|---|
| `TenantDetailPage.tsx` | `TenantTab` + `"workflow-tools"`; `TabsTrigger value="workflow-tools"` giữa Agent và Quota; `TabsContent` bọc `<Suspense>` + `TenantToolsTab` nạp `lazy()` (+≈ 8 dòng, file còn ≈ 180) |
| route `$tenantId.tsx` | `TABS` thêm `"workflow-tools"` |
| `components/tools/TenantToolsTab.tsx` (≤ 140) | `Card` + `SearchBox "Tìm tool"` (lọc client tên/key) + `Table aria-label="Tool quy trình"`; trạng thái `LoadingState`/`ErrorState`(retry)/`EmptyState`(+ "Mở Workflows")/`EmptyState "Không có tool nào khớp."`; 403 ⇒ `ForbiddenState` |
| `components/tools/ToolRow.tsx` (≤ 90) | cột Tên · Ký hiệu (mono) · Ghi chú (`Badge warn "Tác dụng phụ"`, `Badge off "Workflow đang tắt"` + tooltip khi `enabled=false`) · Bật bởi (`granted_by · granted_at` dùng `Intl` locale như `Header` của trang, "—" khi null) · `Switch aria-label="Bật tool {name}"` hiển thị `on`; dòng `pending` ⇒ `disabled` |
| `components/tools/ToolOffDialog.tsx` (≤ 60) | `ConfirmDialog destructive` "Tắt tool {name}?" / body / nút "Tắt tool" |
| `hooks/use-tenant-tools.ts` (≤ 80) | list + `toggle(row, want)`: bật ⇒ `PUT …/workflow-tools/:workflow_id {}` ngay + toast; tắt ⇒ mở dialog ⇒ `DELETE` + toast; 404 ⇒ toast `toast.gone` + refetch; lỗi khác ⇒ `notifyError`, công tắc về cũ (invalidate) |
| `api.ts` (124 → ≈ 150) | 3 hook: `useTenantWorkflowTools(id)`, `usePutTenantTool(id)`, `useDeleteTenantTool(id)` (contract `TenantWorkflowToolList` T17) |
Mã `GET …/workflow-tools` trả `items[]`: `workflow_id, key, name, side_effect, enabled, on, granted_at, granted_by`.
## 13. Domain · lỗi · e2e P-d2
Lỗi: bảng §6 + khoá §4 file i18n (`TOOL_INVALID`, `TOOL_SIDE_EFFECT`, `BRANCH_INVALID`, ref tool); `lib/errors.ts` (74 dòng) ánh xạ mã ⇒ khoá; path server `stages.i.executor.args.<name>`, `stages.i.after.branch.j.<field>`. **Roles/nhãn cho e2e (giữ đúng khi code):**
| Màn | Locator |
|---|---|
| Editor | `combobox "Người thực hiện"` → option "Gọi tool"; `group "Gọi tool"` → `combobox "Tool"`, `combobox "Nguồn của tham số so_hop_dong"` (+ `getByLabel("Giá trị của tham số so_hop_dong")`); `group "Rẽ nhánh"` → `combobox "Nếu trường"`, `"Phép so sánh"`, `getByLabel("Giá trị")`, `combobox "Thì tới bước"`, `button "Thêm luật rẽ nhánh"`, `button "Xoá luật 1"`; canvas: nút tên bắt đầu `Giai đoạn n: …` chứa "Gọi tool" / "Rẽ nhánh · 2 luật"; cạnh nhãn "Rẽ nhánh · luật 1"; StepList: "Rẽ nhánh: luật 1 tới bước 3" |
| Tenant | `tab "Tool quy trình"`, `table "Tool quy trình"`, `switch "Bật tool Gửi nhắc thanh toán"`, `alertdialog "Tắt tool Gửi nhắc thanh toán?"` + `button "Tắt tool"`/`"Huỷ"`, `searchbox "Tìm tool"` |
| Chat | `listitem` chứa "Bỏ qua"; `region "Cần người quyết"` "Gọi tool bị lỗi."; tin thread "Rẽ nhánh: tới bước 3 (luật 1)" |

## 14. Hiệu năng · bundle (Luật 4c, CONVENTIONS §6)
| Mục | Quy tắc |
|---|---|
| **chat-web** | Hiện **141 KB / 150 KB** gzip (`apps/chat-web/scripts/check-bundle.ts`: JS 150, CSS 25, chunk async 50). Việc P-d2 ở chat chỉ ≈ 2 dòng + 1 component `lazy` + khoá i18n ⇒ mục tiêu ≤ **+1 KB**. **Không thêm vào chunk khởi đầu mà chưa đo:** `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web check:bundle` trước và sau; ≥ 146 KB ⇒ dừng, đẩy khoá i18n `process.thread.branch`/`common.tool_failed` vào namespace nạp lười, báo người dùng. Khoá i18n tool/tenant **không** vào bundle chat (namespace `process/admin` chỉ nạp ở admin) |
| admin-web | Editor đã lazy (route + chunk `canvas*` có ngân sách riêng). Lazy thêm: `StageTool` (chỉ khi chọn "Gọi tool"), `TenantToolsTab`; `StageBranch`/`BranchEdge` nằm chung chunk editor/canvas (nhỏ). `check:bundle` admin: chunk async ≤ 50 KB — lệch ⇒ lazy `StageBranch` |
| Render | `ToolArgRow`/`BranchRuleRow` `memo`; `StageView` thêm trường ⇒ `sameView` đủ (không dựng lại canvas khi gõ); danh sách tool ≤ 200 dòng ⇒ `Select` Radix, bảng tenant không virtualize (≤ 200) |
| Mạng | Catalog tool = `process-editor/context` (một request, cache chung); tab tenant chỉ fetch khi mở tab; công tắc không optimistic (chờ server rồi invalidate) |

## 15. Câu hỏi mở
Q-T14-1…4 (giữ args trùng tên+kiểu khi đổi tool; không tự remap `goto` — lỗi live `branch.err.goto`; chat-web ≥ 146 KB ⇒ dừng + lazy i18n; Run admin hiện tên tool) đã thành D2-35…D2-38 ở [`spec-decisions.md`](spec-decisions.md).
