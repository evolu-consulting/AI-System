# Gate M0 — gói duyệt

Ngày: 2026-10-01 · Trạng thái: **ĐÃ DUYỆT 2026-10-01** (người dùng: "duyệt" — chấp nhận toàn bộ mặc định) · Readiness: READY (`M0-bootstrap/readiness.md`, 3 lần)

Trả lời "duyệt" để chấp nhận toàn bộ, hoặc sửa theo số dòng. Sau khi duyệt: ADR Proposed → Accepted, spec → `approved`, qc khoá test, bắt đầu code M0 không hỏi lại (CLAUDE.md Luật 2).

## 1. Phạm vi M0 (hạ tầng, chưa có nghiệp vụ)
- Git + monorepo Bun/Turborepo: `apps/admin-api` (Hono, chỉ `/health`), `apps/admin-web` (Rsbuild + React + Tailwind + shadcn, trang "Admin Console"), `packages/{config,contracts,db,i18n}`, `tools/{mocks,scripts}`.
- Công cụ: Biome, lefthook, `check:size`, dependency-cruiser (10 luật), `trace`, `test:lock`, `i18n:check`, `check:bundle` (≤ 150 KB JS / 25 KB CSS gzip).
- Docker Compose: Postgres 16, Redis 7, Mailpit. Mock Dify + Hub (bun script). Migration schema `admin`/`hub` + bảng stub hub (chỉ dev/test).
- CI GitHub Actions (chỉ tạo file, không push).
- **19 AC** (M0-AC01…19), **29 task**, **12 file test khoá** sau Gate.

## 2. Công nghệ & phiên bản (ADR-0001, tra ngày 2026-10-01)
Bun 1.3.14 · TypeScript **6.0.3** · Turbo 2.11.5 · Biome 2.5.15 · Hono 4.13.12 · zod 4.6.5 · Drizzle 0.45.3 / kit 0.31.11 · postgres.js 3.4.9 · Rsbuild 2.2.11 · React 18.3.1 · Tailwind 4.3.3 · TanStack Router 1.170.41 / Query 5.104.0 · i18next 26.4.2 · Playwright 1.63.0.
ADR cần duyệt: **ADR-0003** (driver postgres.js; TS 6.0.3 vì dependency-cruiser chưa hỗ trợ TS 7). TanStack + react-i18next chuyển **Accepted**.

## 3. Câu hỏi (không trả lời → dùng mặc định)
| # | Câu hỏi | Mặc định |
|---|---|---|
| 1 | Thêm 10 biến env ngoài danh sách cũ (`APP_ENV`, `PORT`, `REDIS_URL`, `TEST_DATABASE_URL`, cổng mock…) | Thêm |
| 2 | Bun giữ 1.3.14 hay nâng 1.4.2 | Giữ 1.3.14 |
| 3 | TypeScript 6.0.3 thay 7.0.2 | 6.0.3 |
| 4 | Commit đầu trên `main` (repo rỗng) | 1 commit docs trên `main`, còn lại trên `feat/M0-bootstrap` |
| 5 | M0 kết nối DB bằng user owner `ai`; cách dùng role hạn chế khi bật RLS | Quyết ở spec M1 |

## 4. Đề xuất kỹ thuật đã tự chốt (xem `M0-bootstrap/spec.md` §9)
24 đề xuất từ qc/frontend-lead (qc#1–16, fe#1–8) + 20 bản vá readiness lần 1 + 18 bản vá lần 2. Đáng chú ý: tách tsconfig browser/node cho web; `bun test` loại e2e và test tích hợp; `trace` chỉ đếm mã ở tên test; CI fetch nhánh `main` cho kiểm "file thay đổi"; mock `/internal/test-run` theo HUB-FR-51 (hình tạm, M2 chốt).

## 5. Design (duyệt hướng — dùng cho M1 trở đi, không chặn M0)
Canvas https://claude.ai/artifact/FTSiKuF9ax5DkMBVKMdHDB · **18 artboard** (8 cũ + 10 mới). Chưa chốt:
- Tên tenant mẫu thống nhất → mặc định "Acme Việt Nam".
- 8 câu hỏi màn mới (`_design/admin-missing-screens.md` §15): không có "Xoá tenant"; mã công ty/username không đổi; 2FA tuỳ chọn, 10 mã dự phòng; admin tắt 2FA hộ được; reset mật khẩu đăng xuất mọi thiết bị; tenant_admin không Khôi phục nhật ký… → mặc định như file.
- Đề xuất chép nguồn canvas vào `docs/design/canvas/` + trích `tokens.md` → mặc định **làm** trước M1.
