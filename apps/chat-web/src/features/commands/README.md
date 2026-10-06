# commands — menu `/` (HUB-FR-10, X1-AC01/02)
`api.ts` `useCommandMenu(enabled)` = `GET /commands` (`CommandMenuResponseSchema`), nạp lười lần đầu gõ `/`, cache 5 phút, không retry tự động (lỗi + "Thử lại"); 403 → danh sách rỗng.
`lib/slash.ts` thuần: `slashQuery` (khi nào mở; `//…` không mở), `filterCommands` (tiền tố name/alias), `argSyntax`, `fillCommand`, `leadingCommand`.
UI ở `features/composer` (`CommandMenu`, `SuggestMenu` dùng chung với menu `@` của F2, `SendErrorNotice` cho `CMD_*`). `//x` gửi nguyên văn, Hub bỏ một `/`.
