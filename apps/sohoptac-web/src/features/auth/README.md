# features/auth — đăng nhập contracts-web (S01)

- FR: PK-FR-10 (N1 TF4, plan-frontend §1, §7; D-19, D-21).
- Điểm vào: `pages/LoginPage.tsx` (route `/login?next=&tenant=`), `lib/guard.ts` (`requireSession` cho `_authed`, `redirectIfAuthed` cho `/login`, nạp động), `hooks/use-session-redirect.ts` (hết phiên / đăng xuất ⇒ `/login?next=`).
- Phiên: `lib/session.ts` = `createSession` của `@ai/web-kit` với tên app/kênh/khoá riêng (`contracts`, `ai-contracts-auth`, `ai-contracts-refresh`).
- Gọi API chỉ ở `api.ts` (`/auth/login`, `/auth/logout`); component không fetch.
- Phụ thuộc: `@ai/web-kit` (session, http), `@ai/contracts/chat` (kiểu đăng nhập), i18n `contracts.login.*`.
