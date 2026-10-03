# features/shell

Khung quản trị M1 [ADM-FR-60] [ADM-FR-04] [ADM-FR-01].

- `components/`: `AppShell` (skip-link, Sidebar, Topbar, `<main id="main">`, Toaster, modal phiên hết hạn), `AuthedLayout` (member → `BareLayout`), `Sidebar`/`SidebarNav`, `Topbar` (breadcrumb, badge, `AccountMenu`), `SessionExpiredGate`.
- `lib/nav.ts`: menu theo role (thuần, có test); `lib/guard.ts`: guard `requireSession`/`redirectIfAuthed` cho route.
- `hooks/use-account-actions.ts`: đổi ngôn ngữ (PATCH `/auth/me`, lỗi thì hoàn lại) và đăng xuất.
- `pages/`: `NotFoundPage` (404 chung, nạp lười từ `routes/__root.tsx`).

Phụ thuộc: `lib/session`, `features/auth/api`, `components/shared/*`.
