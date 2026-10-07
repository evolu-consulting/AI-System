# directory — danh bạ (HUB-FR-102)
`api.ts`: `fetchDirectory(q)` = `GET /directory?q=` (`DirectoryResponseSchema`, 4 trường: id, display_name, username, active); `useDirectory(q, enabled)` cache 30 s, không retry. `q` debounce 250 ms ở nơi gọi. UI chọn người (PersonPicker) thêm ở F3.
