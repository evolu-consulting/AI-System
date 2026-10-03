# auth — đăng nhập chat (UC-01 · CHAT-AC-01, 02, 04)
`/login`: LoginForm (nhớ mã công ty, Đổi công ty), lỗi chung, LockedDialog, alert `login.useAdmin`; guard `_authed` (`lib/guard.ts`); `useSessionRedirect` (hết phiên → `/login?next=` + toast). Gọi API chỉ qua `api.ts` (bọc `~/lib/auth/session`).
