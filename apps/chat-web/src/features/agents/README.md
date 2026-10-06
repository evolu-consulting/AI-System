# agents — menu `@` (HUB-FR-91, X1-AC04)
`api.ts` `useAgentMenu(enabled)` = `GET /agents` (`AgentMenuResponseSchema`), nạp lười lần đầu gõ `@`, cache 60 s, không retry tự động; 403 → rỗng.
`lib/mention.ts` thuần: `mentionQuery` (token tại con trỏ bắt đầu `@`, không `@@`, mọi token trước là tag `@key`), `filterAgents` (tiền tố key hoặc chứa trong tên theo ngôn ngữ), `fillAgent`, `leadingTag`, `replaceTag`.
UI ở `features/composer` (`AgentMenu`, `SuggestMenu` dùng chung, `SendErrorNotice` cho `AGENT_NOT_FOUND`). `@@x` gửi nguyên văn, Hub bỏ một `@`. `responder` (tên agent) lấy từ `run.started` / `Message.responder`, hiện ở `ConsultantAvatar`.
