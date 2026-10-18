# Test plan · P-d2 (T15) · stage `tool` + công tắc tool theo tenant + rẽ nhánh (phụ lục của [test-plan.md](test-plan.md))

Nguồn: spec-d2, spec-tz-tools §2, plan-d2, plan-contract §6–§7, plan-db §3–§4, AC-H44/H45/H47, A15. Quy ước: [test-plan §1–§2](test-plan.md).

**Dify giả** (`_support/fake-dify.ts`): `Bun.serve` cổng 0, `POST /v1/workflows/run` theo kịch bản từng ca (JSON `outputs.<output_field>`; HTTP lỗi; treo quá `timeout_s`; đóng socket = `sent:true`; cổng đóng = chưa gửi), đếm lời gọi, lưu `user`/`inputs`. Fixture: `W` `xuat-hoa-don` (`tong_tien` number required, `ma_kh` text), `WS` side effect, `WF` tham số `file`, `WOFF` tắt, `W20`.

**Cổng lớp:** test nạp `loadLayer(layer, tên, task)` qua barrel `P/{domain,application}/index.ts` (T17); vắng ⇒ "chưa có cổng lớp / chưa có tính năng: <tên> (<task>)". Luật lưu def (U01–U03, U10–U11) qua hàm contract.

## 1. Luật lớp 1 P-d2 — `tests/acceptance/P-d/rules/d2/{tool,branch,def-issues}.test.ts` (plan-d2 §4)
| Ca | File · hàm | Dữ liệu | Kỳ vọng |
|---|---|---|---|
| PD2-U01 | `defs/tool-def.rules` `toolStageIssues` | stage tool `W`, args `tong_tien←{from:"field",stageKey:s0,field:"tong_tien"}` (s0 ở bước nhỏ hơn), `ma_kh←{from:"const",value:"KH1"}` | `[]` |
| PD2-U02 | ″ | 21 args; thiếu `tong_tien`; tên `xyz` ∉ params; tool `WF` (param `file`); input/field không có; field cùng bước / bước lớn / không khai; stage có sources / must_know / autofix | `TOOL_INVALID`; path (A2): `stages.<i>.executor` cho 21 args / `WF` / sources / must_know / autofix / `answerer≠starter`; `…executor.args.<tên>` cho các lỗi còn lại |
| PD2-U02b | `paramCompatible(sourceType, paramType)` (D2-29, **#100**) + `toolStageIssues` | 20 vector theo plan-d2-rules §2; 22 cặp nguồn→tham số (vd `number`←const `"5"`/field string; `boolean`←const `"true"`; `select`←const ∉ options) | đúng ⇒ `[]`; sai ⇒ `TOOL_INVALID` path `stages.1.executor.args.<tên>` |
| PD2-U03 | ″ | tool `WS` (`sideEffect`) ở stage `realAction:false` | `[{path:"stages.<i>.real_action",rule:"TOOL_SIDE_EFFECT"}]` |
| PD2-U04 | `tools/tool-run.rules` `buildToolArgs` | input `han`, field s0 `{tong_tien:25000000}`, const `true`; **#100:** tham số 4 `inputTypes`: input number `"25000000"` ⇒ `25000000` (số JS), text `"007"` giữ chuỗi; không truyền ⇒ chuỗi | `{ok:true, values}` đúng kiểu |
| PD2-U05 | ″ | nguồn field của stage `null` (skipped/không output); field vắng; input vắng | `{ok:false, missing:"<tên tham số>"}` |
| PD2-U06 | `classifyToolError` | `{code:"UPSTREAM_ERROR",sent:false}`, `{TIMEOUT,sent:false}`; sent:true với http null / 500 / 503 / 408 / 429 / 400 / 403; `NOT_CONFIGURED`; `INVALID_ARGS`; reason `invalid_output`; code lạ | T,T; T,T,T,T,T,N,N; N; N; N; N |
| PD2-U07 | `toolFailureDecision` | business; transient+side effect+sent; transient+side effect+!sent `S(0..)`; transient không side effect `S(3,1,1,1,1)` | `decide tool_failed`; `decide tool_failed`; `retry 1 (+30 s)`; `decide retry_exhausted` |
| PD2-U08 | `tools/tool-output.rules` `filterToolFields` | `{tong_tien:25000000, ngay:"2026-11-20", thua:1}` (khai number+date); mảng / chuỗi; thiếu required; `tong_tien:"abc"`; date `2026-02-30` | ok (bỏ `thua`); `not_object`; `missing`; `type`; `type` |
| PD2-U09 | `toolOutputMd` | `("Xuất HĐ", {tong_tien:25000000, ma_kh:"KH1"})` | khớp nguyên văn plan-d2 §4 / A7 (thứ tự khai báo; không trường ⇒ không dòng bảng + `Đã gọi tool; trường: (không có)`; `\|` thoát, xuống dòng ⇒ dấu cách) |
| PD2-U10 | `branch/branch-def.rules` `branchStageIssues` | luật hợp lệ `tong_tien gt 20000000 ⇒ 3` ở stage step 1 đứng một mình | `[]` |
| PD2-U11 | ″ | 11 luật; stage cùng bước với stage khác; field ∉ fields; `lt` với string; value khác kiểu; date sai lịch; `gotoStep` = step; < step; ≥ số bước; đích `realAction` ∧ after `auto` | mỗi ca `BRANCH_INVALID` |
| PD2-U12 | `branch/branch.rules` `evaluateBranch` | luật `[gt 20000000⇒3, eq 0⇒2]`: 25000000; 0; 1000; fields null; trường vắng; date `lt "2026-12-01"` với `"2026-11-20"` | `{gotoStep:3,rule:1}`; `{2,2}`; null; null; null; `{…,rule:n}` |
| PD2-U13 | `skippedStages` | steps `[0,1,2,3]`, from 1, goto 3 | `[2]`; goto 2 ⇒ `[]` |
| PD2-U14 | `effectivePrevStep` | bước 2 toàn `skipped`, hỏi bước 3 | 1; bước 0 ⇒ null |
| PD2-U15 | `tasks/decision.rules` | `decisionOptionsFor(false,"tool_failed")`, `(true,"tool_failed")`; `FORCE_USE_CURRENT` | `[add_attempt,cancel]`; cả 3; không chứa `tool_failed` |
| PD2-U16 | `runs/run-state.rules` | `tool_failed` + `add_attempt` | attempt + 1 (như `agent_failed`, D-PD04) |
| PD2-U17 | `runs/step.rules` | `stepJoin`/`runStatusOf` với `skipped` | `skipped` = xong |
| PD2-U18 | `gates/back.rules` `backResetPlan` | quay lại bước 1 khi bước 2 `skipped` | stage `skipped` ⇒ `pending`, `round` không tăng |
| PD2-U20 | admin `workflow-tools/domain/toggle.rules.ts` `toggleChange` | `(null,on)`, `({revokedAt:X},on)`, `({revokedAt:null},on)`, `({revokedAt:null},off)`, `({revokedAt:X},off)`, `(null,off)` | insert, reactivate, none, revoke, none, none |

## 2. Contract P-d2 — `rules/d2/contracts-pd2.test.ts`
| Ca | Kỳ vọng |
|---|---|
| PD2-C01 | `STAGE_RUN_STATUSES` cuối `skipped` (11); `DECISION_REASONS` cuối `tool_failed` (23); `EXECUTOR_KINDS` cuối `tool` (5); `PROCESS_DEF_RULES` slice(16) = `[TOOL_INVALID,TOOL_SIDE_EFFECT,BRANCH_INVALID]`; `PROCESS_REF_KINDS` cuối `tool`; `ROOM_PROCESS_KINDS` cuối `branch` (8); `HistoryItem.kind` ∋ `branch` |
| PD2-C02 | hằng `TOOL_ARGS_MAX=20`, `TOOL_RESULT_MAX_BYTES=65536`, `BRANCH_RULES_MAX=10`, `BRANCH_OPS`; domain `limits.ts` bằng contract |
| PD2-C03 | executor `tool` nhận args 3 loại nguồn; 21 args lỗi; tên tham số sai regex lỗi; `after.branch` mặc định `[]` ở cả `review` và `auto`; 11 luật lỗi; `op:"in"` lỗi |
| PD2-C04 | `RoomProcessPartSchema` `branch {process_run_id, stage_idx, to_step, rule}`; `rule` 0/11 lỗi |
| PD2-C05 | `TenantWorkflowToolSchema`, `…ListSchema` (≤ 200), `…PutSchema` strict `{}`; `ProcessToolItemSchema`, `ProcessEditorContextSchema.tools` optional; `params` 50 ok / 51 lỗi; `options` chỉ khi `select`; `description` 400 ok / 401 lỗi |

## 3. Int P-d2 — `tests/acceptance/P-d/d2/*.int.test.ts`
### 3.1 Stage `tool` (AC-H44 · HUB-FR-146 · HUB-BR-12 · HUB-FR-109) — `d2/tool.int.test.ts`
| Ca | Bước | Kỳ vọng |
|---|---|---|
| PD2-I01 | acme bật `W`; s0 agent (`tong_tien`) → s1 tool `W` (`tong_tien←field s0`, `ma_kh←input`) → s2; fake trả `{so_hd,tong_tien}` | 1 lời gọi; `user` = `difyUser(tenantKeyOf(catalog, acme), lan)` (S1); `inputs` `{tong_tien:25000000, ma_kh:"KH1"}`; 0 job agent s1; `run_steps type='tool'` `agent_id` NULL; `usage_logs`; `process_outputs.fields`; .md = `toolOutputMd`; audit `tool_call` không chứa giá trị; s2 có job |
| PD2-I02 | fake trả `tong_tien:"abc"` / không JSON / mảng (**int**, AC-H44) | `needs_decision` `template_invalid` **ngay** (D2-05), Dify 1 lần |
| PD2-I03 | kết quả 65.537 byte | `tool_failed` |
| PD2-I04 | `WS` (side effect) ở stage `real_action` sau gate Đạt; fake trả 500 **sau khi nhận** | `tool_failed`, Dify 1 lần, 0 hẹn `retry`; `run_steps` có trace `confirmation:"gate_review"` |
| PD2-I05 | `W` (không side effect): fake 503 lần 1, ok lần 2 | hẹn `retry` +30 s; bắn ⇒ gọi lần 2 ⇒ `done`; `retry_count` 1 |
| PD2-I06 | `WS`: `base_url` trên cổng giữ trước (bind rồi đóng): lần 1 chưa có server (ECONNREFUSED ⇒ lỗi trước gửi); dựng fake trên cổng đó **trước** khi hẹn `retry` bắn | thử lại (PD2-R05), tổng 1 lời gọi tới handler |
| PD2-I06b | `WS`: fake nhận kết nối rồi đóng socket (trước/sau đọc body) | `sent:true` ⇒ `tool_failed` (an toàn, không gọi lại), Dify 1 lần, 0 hẹn `retry` (Q-D2-2) |
| PD2-I07 | fake 400 / 403 | `tool_failed` ngay |
| PD2-I08 | fake treo > `timeout_s` (`W`) ×4 | 3 hẹn retry, rồi `retry_exhausted` |
| PD2-I09 | nguồn field của s0 không có (s0 output thiếu `tong_tien`) | `tool_failed`, 0 lời gọi |
| PD2-I10 | lưu def: `WS` ở stage không `real_action` | 422 `PROCESS_DEF_INVALID` `rules ∋ TOOL_SIDE_EFFECT`, `paths ∋ stages.<i>.real_action` |
| PD2-I11 | lưu def: thiếu tham số required; args 21 (zod) | 422 `TOOL_INVALID` `paths ∋ stages.<i>.executor.args.<tên param thiếu>`; 400 `VALIDATION_ERROR` |
| PD2-I12 | lưu def: `tool_key` không tồn tại; `WOFF`; `W` chưa bật cho beta (def beta); def mẫu (`tenant_id` null) chứa tool | 422 `PROCESS_REF_INVALID {path:"stages.<i>.executor.tool_key", ref:"tool"}` cả 4 (thông điệp như nhau) |
| PD2-I13 | lưu def stage tool có template/token_budget tuỳ ý (answerer starter, T15b-1) | `GET`: `required_sections=["Kết quả","Bàn giao"]`, template `"# {name}\n\n## Kết quả\n\n## Bàn giao\n"`, `answerer={kind:"starter"}`, `sources=[]`, `must_know=[]`, `autofix=null`, `token_budget=null`, `timeout_s` giữ |
| PD2-I14 | `decide use_current` khi `tool_failed` không output / `add_attempt` | 409 `NO_OUTPUT` / attempt+1, gọi lại 1 lần |
| PD2-I15 | `GET /process-editor/context` acme / beta / mẫu | `tools` = [W] / [] / [] (TT-R04; `WOFF` không có) |
| PD2-I17 | **#100** input `so-tien` kiểu `number` = `"25000000"` → tool `tong_tien←input` | Dify nhận `inputs.tong_tien === 25000000` (typeof number), `ma_kh` chuỗi; `INPUT_TYPES` thiếu `number` ⇒ đỏ "chưa có tính năng" (T15c-2) |
| PD2-I18 | **#101** s0 agent → s1 tool `after.review` (G1, `branch gt 20000000⇒3`) → s2 → s3; biến thể `auto` | review: s1 `waiting_review` + 1 review task mở, 0 job s2; B Đạt ⇒ s1 `done`, s2 `skipped`, `current_step` 3, s3 có job, Dify 1 lần. auto: s1 `done` + join, 0 task, s2 có job |
| PD2-I16 | `/mcp` hồi quy (T18s tách `WorkflowInvoker`) | chạy lại test `/mcp` khoá (H2a, X1) xanh; agent gọi `WS` vẫn qua cổng xác nhận |

### 3.2 Công tắc tool + cách ly (AC-H47 · TT-R04…R08 · hard stop) — `d2/tool-switch.int.test.ts`
| Ca | Bước | Kỳ vọng |
|---|---|---|
| PD2-I20 | `W` bật acme, chưa bật beta | editor acme thấy `W`; beta không; beta lưu def dùng `W` ⇒ 422 `PROCESS_REF_INVALID` |
| PD2-I21 | run acme đang ở s0 (trước stage tool) ⇒ `padmin` `DELETE …/workflow-tools/W` cho acme ⇒ s0 xong | s1 `needs_decision` `tool_failed`; Dify 0 lời gọi |
| PD2-I22 | như I21 nhưng tắt trong lúc s1 đang backoff `retry` | bắn hẹn ⇒ `tool_failed`, 0 lời gọi mới |
| PD2-I23 | sau I21: bật `W` cho **beta** | run acme mới vẫn `tool_failed` (công tắc đọc theo `run.tenant_id`) |
| PD2-I24 | `admin.workflows.enabled=false` cho `W` khi run chờ | `tool_failed` |
| PD2-I25 | người bắt đầu không có agent grant nào, thuộc Group được chạy quy trình | chạy được, Dify 1 lời gọi |
| PD2-I26 | thu hồi Group chạy quy trình của A / khoá A trước stage tool | `permission_lost` / `user_inactive`, 0 lời gọi |
| PD2-I27 | lời gọi đang bay khi tắt công tắc (fake giữ 1 s) | lời gọi hoàn tất, stage `done` (TT-R07: không huỷ lời gọi đã gửi) |

### 3.3 Rẽ nhánh (AC-H45 · HUB-FR-147 · HUB-BR-38(e)) — `d2/branch.int.test.ts`
Def 5 bước (step 0…4): s1 ở step 1 (agent, fields `tong_tien` number, `after.review` G1, `branch:[{field:"tong_tien",op:"gt",value:20000000,goto_step:3}]`), s2 ở step 2 (có `wait_until` + hẹn để kiểm huỷ), s3 step 3, s4 step 4.
| Ca | Bước | Kỳ vọng |
|---|---|---|
| PD2-I30 | s1 `tong_tien` 25000000 ⇒ B Đạt | s2 `skipped` (`finished_at`); `current_step` 3; s3 có job; tin thread **"Rẽ nhánh: tới bước 4 (luật 1)"** (part `branch {stage_idx:1,to_step:3,rule:1}`); audit `branch` (actor hệ thống, `{from_step:1,to_step:3,rule:1}`); 0 job s2 |
| PD2-I31 | `tong_tien` 1000 | s2 chạy (tuần tự), 0 audit `branch` |
| PD2-I32 | sau I30, quay lại `back_to_steps` 1 | s2 `skipped` ⇒ `pending`, `round` s2 không tăng; s1 chạy lại; lần sau 1000 ⇒ đi s2 |
| PD2-I33 | sau I30 | 0 hàng `process_timers` mở cho stage `skipped` (PD2-R13; hẹn chỉ có ở stage đã vào chạy — Q-D2-3) |
| PD2-I34 | lưu def: `goto_step` 1 (= step); stage rẽ nhánh trong bước song song; đích `real_action` với `after.kind=auto` | 422 `BRANCH_INVALID` |
| PD2-I35 | run kết thúc khi s2 `skipped`, s3/s4 done | run `done` (skipped = xong) |
| PD2-I36 | đích s3 `real_action`, s1 review Đạt, s2 skipped | s3 chạy được (D2-08 bước trước có hiệu lực = s1) |
| PD2-I37 | `wait_until` có nguồn field ở stage bị `skipped` | `timer_invalid` (AC-H41 vế "stage nguồn skipped") |

### 3.4 Admin công tắc (AC-A15 · ADM-FR-73 · TT-R01…R03) — `admin/workflow-tools.int.test.ts` (harness M1/M3)
| Ca | Bước | Kỳ vọng |
|---|---|---|
| PD2-I40 | `padmin` `GET /admin/tenants/:acme/workflow-tools` | mọi workflow catalog sắp theo `key`, mỗi dòng `{workflow_id,key,name,side_effect,enabled,on:false,granted_at:null,granted_by:null}` |
| PD2-I41 | `PUT …/W` | 200 `on:true`, `granted_by`=padmin; audit `entity:"workflow"`, `action:"grant"`, `tenant_id` acme, `entity_id` W, before `{on:false}` after `{on:true}`; NOTIFY `config_changed {entity:"workflow", tenant_id: acme}` |
| PD2-I42 | `PUT` lần 2 | 200 không đổi, 0 audit mới, 0 NOTIFY |
| PD2-I43 | `DELETE …/W`; `DELETE` lần 2 (ca riêng, **#109**); `PUT` lại | `on:false`, `revoked_at` đặt, audit `revoke`; lần 2: 200, 0 audit, `revoked_at` giữ; `PUT`: `revoked_at` NULL, `granted_by` mới, audit `grant` |
| PD2-I44 | `tadmin` GET/PUT/DELETE | 403 |
| PD2-I45 | tenant không tồn tại (GET/PUT/DELETE, **#109**) / workflow không tồn tại; body PUT có trường thừa | 404 `NOT_FOUND`; 400 |
| PD2-I46 | RLS: `admin_rw` scope tenant beta `select admin.tenant_workflow_tools` | 0 hàng acme; scope platform thấy hết; `hub_ro` SELECT được; `hub_ro` INSERT ⇒ 42501 |
| PD2-I47 | DB: PK `(workflow_id, tenant_id)` trùng ⇒ 23505; xoá workflow ⇒ cascade; xoá user `granted_by` ⇒ NULL; index `tenant_workflow_tools_tenant_active_idx`; migrate 2 lần idempotent | như mô tả |

### 3.5 DB hub 0037 — `d2/db.int.test.ts`
| Ca | Kỳ vọng |
|---|---|
| PD2-I50 | CHECK nới: `stage_runs.status='skipped'`, `review_tasks.reason='tool_failed'`, audit `tool_call`/`branch`, `process_thread_events.kind='branch'`, `room_messages.process_kind='branch'`; giá trị cũ giữ; lạ ⇒ 23514 |

### 3.6 Use case `runToolStage` với cổng giả (S2/S9/S10/S12, D2-13) — `rules/d2/run-tool-stage.test.ts` (không DB)
ok · S10 (nhật ký trước `invoke` = `[tx, loadCall]`; mất quyền ⇒ `permission_lost`/`user_inactive`, 0 lời gọi) · S2/S9 (công tắc/workflow tắt, nguồn field `null` ⇒ `tool_failed`) · S12 (65.536 byte ok; 65.537 byte, 32.770 ký tự `đ` ⇒ `tool_failed`; sai kiểu ⇒ `template_invalid`) · D2-13 (503 đã gửi ⇒ hẹn `retry` +30 s; side effect + 500 ⇒ `tool_failed` 0 hẹn; 3 lượt ⇒ `retry_exhausted`).

### 3.7 Hiệu năng (Luật 4c, plan-d2 §9) — `perf/d2.perf.int.test.ts` (`bun run test:perf`)
| Ca | Đo | Ngưỡng |
|---|---|---|
| PD2-P01 | PUT def 30 stage / 10 tool × 20 | p95 ≤ 50 ms và ≤ p95 cùng def 0 tool + 5 ms (**#109**); số câu có tool − không tool = **1** |
| PD2-P02 | 200 workflow × 50 tenant (10.000 hàng công tắc), `GET /process-editor/context` × 30 | p95 ≤ 20 ms; **2** câu |
| PD2-P03 | đếm câu **từ trước khi s0 xong** (`jobDone` s0) tới `settled()` (#110), 1 vs 20 tham số (`W20`) | bằng nhau; (câu − mốc agent cùng cửa sổ) ≤ **14** (#109); p95 ≤ 60 ms |
| PD2-P04 | đếm câu của POST Đạt + `settled()`: nhảy 1 vs 18 bước (def 21 bước); mốc = def **không** `branch` (#97, D2-33) | bằng nhau; khớp − mốc = **4**; không khớp − mốc = **1** (`fields`); p95 ≤ 30 ms (đúng khoảng đo) |
| PD2-P05 | T17b (D2-32): `GET /process-runs?limit=50` (Adm), 50 run không hẹn vs có hẹn mở (SQL) | số câu bằng nhau; p95 ≤ 40 ms và ≤ không hẹn + 5 ms; thiếu trường wait/retry ⇒ đỏ ngay |

### Đỏ đúng lý do (T15 → T15c, 2026-10-18, trước T17)
- T15/T15b: rules 309 / 52 fail; int d2 0/33; perf 5 fail — "chưa có cổng lớp / chưa có tính năng"; P-d1 0 đỏ.
- T15c: rules 309 / 56 fail (+4: `paramCompatible`, `buildToolArgs` ×2, ma trận `toolStageIssues`); int d2 0/33 + tool.int I02×3, I17, I18×2 ; e2e `-g PD2-E` 5/5 đỏ vài giây ở `needPd2`.
## 4. Test khoá sửa ở P-d2
K15 (`contracts-pa.test.ts:175`, T17) · K28 (`M1/M2/M3 db-rls` 13 ⇒ 14 bảng, T18a). T18s/T19s: không test khoá nạp file theo đường dẫn.

## 5. E2E P-d2 (T15c) — kỳ vọng ở [test-plan-e2e](test-plan-e2e.md) PD2-E01…E05; viết vào config P-d sẵn có (cùng stack P-b2)
`admin-stage.pd.ts` E01 (Gọi tool), E02 (Rẽ nhánh), E05 (tenant `globex`); `admin-tenant.pd.ts` E03; `chat-labels.pd.ts` E04. Seed `_pd-support.ts`; mọi ca gọi `needPd2()` đầu (thiếu 0012/0037 ⇒ đỏ ngay). Chạy `-g PD2-E`.

## 6. Tranh chấp / câu hỏi
Q-D2-1…5, T15-1…4, T15b-1…3 (đã có mặc định, đã áp) ⇒ [spec-decisions](spec-decisions.md) D2-40, D2-41.
| # | Gửi | Nội dung | Mặc định (đã áp trong test) |
|---|---|---|---|
| T15c-1 | frontend-lead | Nhãn chọn trường nguồn của tham số `field` chưa ghi | `combobox "Trường của tham số {name}"` (E01) |
| T15c-2 | backend-lead | (a) `INPUT_TYPES` quy trình không có `number` mà D2-29 cần; (b) tên trường wait/retry của `ProcessRunSummary` (T17b) | (a) thêm `number`, giá trị `{type:"number",key,value:"<chuỗi số>"}` (I17); (b) P05 nhận khoá bắt đầu `wait`/`retry` |
| T15c-3 | qc | E02 cần stage đứng một mình ở bước 0; E05 dùng `globex`/`hoa` làm "beta" | Seed riêng `pd2-branch`, `pd2-globex` |
