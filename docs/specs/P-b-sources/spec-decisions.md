# P-b-sources · Quyết định lúc làm + Tranh chấp test

Tách khỏi `spec.md` §9 để spec gọn dưới trần 25KB (log này tăng dần mỗi lát BUILD). Quyết định Gate + bảng chốt C1–C23 vẫn ở `spec.md` §9 (canonical).

## Quyết định trong lúc làm (agent tự quyết theo Luật 2 — một dòng/quyết định)
- **S4/#134** · `mapTeamError`→`sources.rules.ts` (tối thiểu); `closeMemberRun` msg/hint từ `runErrorText`; `not_configured`⇒decision `agent_failed`, `hub.runs` giữ `NOT_CONFIGURED`; `runMember` try/catch+`!direct`⇒`not_configured`; `drive` catch `failStuckRun`⇒`toDecision` (TM-11).
- **S4/#133** · `persistState` advance ghim `current_output_id=outputId` (gốc: trước dùng `hasOutput` stage kế ⇒ O0 không ghim ⇒ `priorFiles` rỗng); nháp `persistDraft` thành `hub.attachments` thật; guard `runScopedFileIds`@`priorFiles` (PB-R18).

## Tranh chấp test
<!-- để trống -->
