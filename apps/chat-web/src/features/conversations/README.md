# conversations — danh sách hội thoại (UC-05, UC-06 · CHAT-AC-19, 21, 22)
`api.ts`: E5 (trang 50, cursor, `q`), E6 tạo, E8 đổi tên, E9 xoá. `hooks/use-conversations`: `useConversationList` (infinite query), `useCreateConversation`, `useRenameConversation`, `useDeleteConversation`, `useInvalidateConversations`.
Không có UI riêng — sidebar ở `shell`, trang chào ở `thread`.
