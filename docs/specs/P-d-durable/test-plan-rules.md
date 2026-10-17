# Test plan · P-d1 · luật lớp 1 hẹn giờ, def, nhắc (phụ lục của [test-plan.md](test-plan.md) §4)

Quy ước như [test-plan §4](test-plan.md): nạp `loadDomain("<rel>")` = `P/domain/<rel>`; `N` = `2026-10-19T01:00:00.000Z`; file test `tests/acceptance/P-d/rules/<nhóm>.test.ts`.

## 1. Ca
| Ca | File · hàm | Dữ liệu | Kỳ vọng |
|---|---|---|---|
| PD-U43 | `timers/due-at.rules` `localToUtc` | `2026-11-17 09:00 Asia/Ho_Chi_Minh` | `2026-11-17T02:00:00.000Z` |
| PD-U44 | ″ DST Berlin | `2026-03-29 09:00`, `2026-03-28 09:00` | `07:00Z` (CEST), `08:00Z` (CET) |
| PD-U45 | ″ khe tiến giờ | `Europe/Berlin 2026-03-29 02:30`; `America/New_York 2026-03-08 02:30`; `Australia/Sydney 2026-10-04 02:30` | `2026-03-29T01:30Z`; `2026-03-08T07:30Z`; `2026-10-03T16:30Z` (offset **trước** chuyển) |
| PD-U46 | ″ giờ lặp lùi giờ | `Europe/Berlin 2026-10-25 02:30`; `America/New_York 2026-11-01 01:30`; `Australia/Lord_Howe 2026-04-05 01:45` (lệch 30') | `00:30Z`; `05:30Z`; `2026-04-04T14:45Z` (lần **đầu**) |
| PD-U47 | `wallClockOf` | `2026-03-29T01:30Z`, Berlin | `{date:"2026-03-29",time:"03:30"}` |
| PD-U48 | `addDaysIso` | `(2028-02-28,+1)`, `(2027-02-28,+1)`, `(2027-03-01,+365)`, `(2028-02-29,−365)`, `(2026-03-02,−3)` | `2028-02-29`, `2027-03-01`, `2028-02-29`, `2027-03-01`, `2026-02-27` |
| PD-U49 | `waitDueAt` | base `2026-11-20`, −3, `09:00`, HCM, now N, expiresAt null | `{ok:true,dueAt:2026-11-17T02:00Z}` |
| PD-U50 | ″ | base null; base `2026-02-30`; expiresAt `2026-11-10T00:00Z`; base N+800 ngày, expiresAt null | `missing`; `invalid`; `after_expiry`; `beyond_horizon` |
| PD-U51 | ″ biên | dueAt = now + 730 ngày đúng; dueAt = now − 1 ngày | `ok`; `ok` (tới hạn ngay) |
| PD-U52 | `waitedText`, `WAIT_SKIP_TEXT`, `waitOutputMd` | `(2026-11-17T02:00Z, "Asia/Ho_Chi_Minh")`; `waitOutputMd("Chờ hạn", line)` | `"Đã chờ tới 2026-11-17 09:00 (Asia/Ho_Chi_Minh)."`; `"Bỏ chờ theo quyết định."`; `"# Chờ hạn\n\n<line>\n\n## Bàn giao\n<line>\n"` |
| PD-U53 | tính tất định | `localToUtc` gọi lại sau khi đổi `Date.now` giả (không dùng) | cùng kết quả (CA-R05) |
| PD-U59 | `defs/wait-def.rules` `waitStageIssues` | stage `wait_until` hợp lệ (from input `han` date; from field step nhỏ hơn) | `[]` |
| PD-U60 | ″ | `after:"review"`; `realAction:true`; `hasSources`; `hasMustKnow`; `hasAutofix` (path theo plan-addendum A2) | `[{path:"stages.<i>.after",rule:"WAIT_INVALID"}]` cho ca `after:"review"`; `[{path:"stages.<i>.executor",…}]` cho 4 ca còn lại |
| PD-U61 | ″ nguồn | input không có / input `text`; field: stage cùng bước / bước lớn hơn / field không có / field `number` | `WAIT_INVALID`, path `stages.<i>.executor.from` (6 ca) |
| PD-U61b | ″ bản nháp chưa qua zod (A2) | `offsetDays` 366 / −366; `time` `"24:00"` / `"9:00"` | `WAIT_INVALID`, path `stages.<i>.executor.offset_days` (2 ca) / `stages.<i>.executor.time` (2 ca) |
| PD-U67 | `defs/escalate-def.rules` `escalateStageIssues` | escalate null; `{afterH:24,groupId:G2}` review G1 | `[]`; `[]` |
| PD-U68 | ″ | `groupId = reviewGroupId`; escalate ở stage `after:"auto"`; `afterH` 3; `afterH` 2161 | cả bốn ca `[{path:"stages.<i>.after.escalate",rule:"ESCALATE_INVALID"}]` (plan-domain:119). `escalate` ở `auto` là luật domain/contract (bản nháp FE); qua API: `afterH` sai và `escalate` ở `auto` ⇒ 400 (PD-C04, PD-I47b/e) |
| PD-U69 | `escalateGroupRefs` | 2 stage có escalate | `[{path:"stages.0.after.escalate.group_id",groupId}, …]` |
| PD-U72 | `defs/ttl.rules` `ttlOnCreate` | undefined, null, 30 | 7, null, 30 |
| PD-U73 | `ttlOnUpdate` | `(undefined, 30)`, `(null, 30)`, `(10, null)` | 30, null, 10 |
| PD-U74 | `expiresAt` | `(N,7)`, `(N,null)` | N+7 ngày; null |
| PD-U76 | `notify/remind.rules` `dueReminder` | cũ: `remindEveryH` null, `remindedAt` null, `remindAt ≤ now` / đã nhắc | t / f (giữ R-N02) |
| PD-U77 | ″ lặp | `remindEveryH:4`, count 9 / 10, `remindAt ≤ now`; task `closed` | t / f; f |
| PD-U78 | `nextRemind` | `{remindAt:N, remindCount:2, remindEveryH:4}` | `{remindAt:N+4 h, remindCount:3}` |
| PD-U79 | `reviewTaskTiming` | `(N,{remindEveryH:null,escalate:null})`; `(N,{4,{afterH:24,groupId:G2}})` | `{remindAt:N+24 h, remindEveryH:null, escalateAt:null, escalateGroupId:null}`; `{N+4 h, 4, N+24 h, G2}` |
| PD-U80 | `noticeRecipients` hồi quy | như R-N01 | không đổi |
| PD-U82 | `notify/escalate.rules` `dueEscalation` | review open, escalateAt ≤ now, escalatedAt null / đã chuyển / kind `ask` / `closed` / escalateAt null | t / f / f / f / f |
| PD-U83 | `escalateAction` | tồn tại + cùng tenant; không tồn tại; khác tenant; `groupTenantId` null | `add_group`; `skip`; `skip`; `skip` |
| PD-U86 | `asks/forward.rules` `forwardCheck` | review G1, `escalatedGroupId:G2`; by H (`byGroupIds={G2}`) → to B (G1) | `FORWARD_OUT_OF_GROUP` |
| PD-U87 | ″ | by B (G1) → T (G1); by H (G2) → thành viên khác G2 | ok; ok |
| PD-U88 | ″ hồi quy | vắng `escalatedGroupId`, `byGroupIds` | như R-AK01…03 |
| PD-U90 | `tasks/decision.rules` `decisionOptionsFor` | `(false,"timer_invalid")`, `(false,"retry_exhausted")`, `(true,"retry_exhausted")` | `[add_attempt,use_current,cancel]`; `[add_attempt,cancel]`; cả 3 |
| PD-U91 | `FORCE_USE_CURRENT` | — | có `timer_invalid`; không `retry_exhausted` |
| PD-U92 | hồi quy autofix | như PC-R10 (`P-c/rules/autofix-rules.test.ts:108`) | không đổi |
| PD-U93 | `runs/team-retry.rules` `teamResumePlan` (đầu vào `cur: {status, segmentStartedAt, cursor} \| null`; trả `"resume_answer" \| "resume_retry" \| "new"` — chữ ký + luật theo plan-addendum A5; `TeamRunStatus` ở `domain/types.ts`) | `null` (chưa có team-run) | `"new"` |
| PD-U94 | ″ | `{status:"running", segmentStartedAt:null, cursor:0}` (đã `pauseForRetry`) | `"resume_retry"` |
| PD-U95 | ″ | `{status:"waiting_answer", segmentStartedAt:null, cursor:0}` và `{…, segmentStartedAt:N, cursor:0}` | `"resume_answer"` cả hai (ưu tiên hơn nhánh retry) |
| PD-U96 | ″ | `{status:"running", segmentStartedAt:N, cursor:0}` (đang chạy dở, không do retry) | `"new"` |
| PD-U97 | ″ | `it.each` `done`, `limit`, `failed`, `cancelled` × `segmentStartedAt` ∈ {null, N} (`cursor:0`); gọi 2 lần cùng đầu vào; đối tượng đầu vào không bị đổi | `"new"` (8 ô); kết quả như nhau; thuần |
| PD-U98 | ″ (A5: `cursor < 0` = dữ liệu hỏng) | `{status:"running", segmentStartedAt:null, cursor:-1}`; đối chứng `cursor:0` | `"new"`; `"resume_retry"` |
| PD-U04b | `runs/job-error.rules` `legacyFailReason` (Q6, A7: `interrupted` thắng) | `{code:"TIMEOUT",interrupted:true}`; `{code:"TIMEOUT",interrupted:false}`; `{code:null,interrupted:true}` | `interrupted`; `job_timeout`; `interrupted` |
