# Readiness — M1-foundation-identity

## Lần 1 — 2026-10-01 · NOT READY

Agent: spec-readiness (chỉ đọc; điều phối ghi lại). Phạm vi: spec.md, plan.md, plan-frontend.md, test-plan.md, tasks.md, ADR-0004.

Không có Chặn. 4 lỗ hổng Cao mới (c), 10 mục Cao có mặc định do agent đề xuất nhưng chưa được người dùng chấp nhận (b), 19 mục Thấp.

### Cao (c) — sửa trước Gate
| # | Vấn đề | Mặc định | Chủ |
|---|---|---|---|
| 1 | `e2e/smoke.spec.ts` (khoá M0) chờ `/` = "Admin Console"; M1 guard `/` → `/login` | qc sửa smoke ở Q2 (phạm vi dự kiến): `/` → `/login`, H1 "Đăng nhập", title "Đăng nhập · Admin", `html[lang=vi]`, không lỗi console. FE1b xoá `features/home` + key `home.*`/`app.meta.title` | qc, frontend-lead |
| 2 | E1: `an` là member nhưng chờ "Tổng quan"; ca khoá tạm khoá user 15' làm hỏng ca sau | Ca shell dùng `binh` (tenant_admin); khoá tạm dùng user riêng `thu`, chạy cuối hoặc `resetFixture()` ngay sau | qc |
| 3 | E1 "phiên hết hạn" không gây được chắc chắn (access 900 s) | Owner `active=false` → request 401 → refresh 401 → dialog; đặt lại `active=true` → nhập mật khẩu → form giữ nguyên | qc |
| 4 | Key i18n `state.offline` và `state.offline.saveTip` chồng nhau trong JSON lồng | `state.offline` → `state.offline.banner` | frontend-lead |

### Cao (b) — trình Gate
5 Ân hạn 10 s `REFRESH_SUPERSEDED` (nới readiness #22) · 6 `VERSION_CONFLICT` `details:{current, updated_at}`, `updated_by` M4 (lệch #4) · 7 Không Xoá tenant (FR-60 "CRUD") · 8 Mã công ty, username bất biến · 9 R01/R03/R04 + sai mật khẩu hiện tại tính khoá tạm · 10 R06 đổi bắt buộc dùng `change_token` không hỏi mật khẩu cũ (lệch #23) · 11 R17 reset mật khẩu thu hồi mọi phiên · 12 R20 seed `must_change_password=false` · 13 B2 cách ly: role `admin_api` NOBYPASSRLS + 2 hàm SECURITY DEFINER chỉ trả `tenant_id` + chặn khởi động nếu role nguy hiểm + env `ADMIN_API_DATABASE_URL` · 14 BR-08 đếm cả tenant khoá; đổi role có hiệu lực ở Hub sau ≤ 15' · 15 ADR-0004 (`sonner` 2.0.8, `@hookform/resolvers` 5.9.1).

### Thấp (mặc định áp luôn)
16 Mật khẩu tạm: 4 `<span>` cách bằng CSS, giá trị/copy = chuỗi gốc 16 ký tự; sửa spec §9 · 17 Giữ D7 · 18 Giữ D8 (mẫu D) · 19 Giữ D12 · 20 Dùng `errors.platformTenantLocked` · 21 M1 toast "Đã lưu {key}" · 22 Sidebar 248px theo artboard · 23 Đóng dialog tạo tenant → `/tenants/<id>` · 24 Bỏ vế "khoá tenant" khỏi R11 · 25 test-plan "G17" → "G13" · 26 Fixture: binh, chi `last_login_at = 2026-09-30T08:00:00Z`, còn lại null · 27 Lệnh xong T6 cụ thể; chấp nhận `test:int` chạy rộng · 28 Lệnh xong M1 thêm `docker compose up -d --wait`, `db:migrate`, `bun run check` · 29 ROADMAP M1 → FR "60, 61, 63" · 30 Viết đủ SQL policy `users`/`refresh_tokens` · 31 `user_count` tính mọi user · 32 prepare-db đọc `SEED_ADMIN_*` từ env · 33 Xoá marker `<!-- backend-lead -->`/`<!-- frontend-lead -->` · 34 Giữ.

### Mâu thuẫn giữa tài liệu (đề xuất giữ)
readiness #22 ↔ spec (ân hạn) → spec, trình Gate · readiness #4 ↔ spec → spec + `details.updated_at` · readiness #23 ↔ R06 → spec · FR-60 CRUD ↔ không Xoá → spec + CR · BR-08 "tenant active" ↔ mọi tenant → spec · D10 ↔ nhóm 4 → nhóm 4 bằng CSS · test-plan E1 ↔ D8 → plan-frontend · ui-admin §7.1 ↔ không có artboard member → mẫu D · Sidebar 240 ↔ 248 → plan-frontend · `toast.saved` → plan-frontend cho M1 · ROADMAP FR-62 → M3.

### Chưa kiểm
CONVENTIONS, INDEX, CODEMAP, STATE, architecture.md, ba-admin §7/§8 toàn văn, artboard `.dc.html`, M0 spec/plan, `.github/workflows/ci.yml`, `tools/scripts/src/i18n-check.ts`.

## Gate 2026-10-01 — câu trả lời người dùng

Người dùng **chấp nhận toàn bộ** mục Cao (b) #5–#15 theo mặc định đề xuất, gom thành 4 câu:
1. **Luật bảo mật** = chấp nhận: R01, R03, R04, R06 (đổi bắt buộc dùng `change_token` 300 s, không hỏi mật khẩu cũ), R17 (reset mật khẩu đăng xuất mọi thiết bị), R20 (seed `platform_admin` `must_change_password=false`); sai mật khẩu hiện tại tính vào khoá tạm; đổi role hiệu lực ngay ở Admin và ≤ 15' ở Hub; ân hạn 10 s `REFRESH_SUPERSEDED` (#5, #9–#12, #14). CR-009, CR-010.
2. **Cách ly tenant B2** = chấp nhận: role `admin_api` NOBYPASSRLS, 2 hàm SECURITY DEFINER chỉ trả `tenant_id`, app thoát nếu role nguy hiểm, env `ADMIN_API_DATABASE_URL` (#13).
3. **Phạm vi** = chấp nhận: không Xoá tenant ở v1 (chỉ Khoá); mã công ty và username bất biến; BR-08 đếm `tenant_admin` ở mọi tenant kể cả đang khoá (#7, #8, #14). CR-006, CR-007.
4. **Contract/thư viện** = chấp nhận: `VERSION_CONFLICT` = `{error:{code,message,details:{current, updated_at}}}`, `updated_by` thêm ở M4 (#6, CR-008); ADR-0004 (`sonner` 2.0.8, `@hookform/resolvers` 5.9.1) Accepted (#15).

Đã sửa trước Gate (không cần hỏi): lỗ hổng Cao (c) #1–#4 và Thấp #16–#33 — các commit `f985da7` (ROADMAP M1 bỏ FR-62), `25ec255` (frontend), `b7a4bca` (test-plan), `bba5882` (spec/plan). Thấp #34 giữ nguyên.

Còn lại: chạy lại spec-readiness (Luật 1 điểm 4) sau khi backend-lead sửa xong contract §3/plan.

## Lần 2 — 2026-10-01 · NOT READY

Agent: spec-readiness (chỉ đọc; điều phối ghi lại). Lần 1: (c) #1–#4 đóng; (b) #5–#15 đã ghi vào spec/BA/CR/ADR; Thấp #16–#33 đã áp (riêng #28 chưa vào test-plan). Không Chặn. 3 Cao mới, đều (c) — không hỏi người dùng. 15 Thấp.

### Cao (c)
| # | Vấn đề | Mặc định | Chủ |
|---|---|---|---|
| 1 | `REFRESH_SUPERSEDED` chưa nói về cookie; xoá cookie sẽ đè cookie mới của tab thắng | Response SUPERSEDED không có `Set-Cookie`; A2.4/A2.7 kiểm vắng `set-cookie` | backend-lead, qc |
| 2 | Lệnh xong T2/T4/T5 cần code của T5–T7; T2–T7 thiếu phụ thuộc Q2 | T2: `rls.int` + D2; T4: test backend + R1; T5: + A1, A3, D3, A8; T7: + A2, A6, A7, D1; Q2 vào phụ thuộc T2–T7 | backend-lead |
| 3 | Playwright (Node) không nạp `.env.local`; `keys:dev` sinh mật khẩu seed ngẫu nhiên lệch `SEED_PW` | `playwright.config.ts` nạp `.env.local` (không ghi đè), truyền env tường minh vào `webServer.env`; e2e đọc `SEED_ADMIN_*` từ env; CI `SEED_ADMIN_PASSWORD=Seed-Admin-Pw-01` | frontend-lead, qc |

### Thấp (áp luôn)
4 spec §1 BR-08 "kể cả đang khoá" · 5 ADR-0004 → Accepted ở spec/plan-frontend · 6 kiểm `details.updated_at` · 7 test-plan §8 chép Lệnh xong spec §8 · 8 "100 ms" · 9 bỏ "counts nên có" · 10 E1 phiên hết hạn: `binh`, drawer Tạo user · 11 username hoa → chuẩn hoá 201; 33 ký tự/ký tự lạ → 400 · 12 T2 sửa `packages/db/src/migrate.int.test.ts` → `{main:3,dev:2}` · 13 `close()` · 14 ca `admin lock zoe` → 409 LAST_ADMIN · 15 tắt dev server 3001 trước e2e · 16 chữ ký `createFirstAdmin` · 17 `thu` chạy cuối file · 18 missing-screens §12.5/§14.9 theo CR-008; nợ Gate M3: câu modal khi chưa có `updated_by`.

## Lần 3 — 2026-10-01 · NOT READY → đã sửa

Lần 2: Cao #1, #3 đóng; #2 đóng một phần. `bunfig.int.toml` có, khớp `test:int`. Không Chặn. 2 Cao (c), 7 Thấp — không hỏi người dùng.
- Cao #1 (lệnh xong T2/T3/T5): T2 thêm 2 env DB vào `.env.example` + R4; D2 không seed; `tests/acceptance/M1/seed.int.test.ts` → T5; `tests/acceptance/M1/server.int.test.ts` → T7. (điều phối sửa tasks.md; qc sửa test-plan)
- Cao #2 (lệnh xong FE0b/FE3): FE0b chỉ `--list`; smoke → FE3; FE3 phụ thuộc T5; ca phiên hết hạn → E3 `users.spec.ts`.
- Thấp áp: #3 T6 thêm `users.service/repo` (chỉ `createFirstAdmin`) · #4 `build` trước `check:bundle` · #5 R4 vào T2, C1 vào FE2 · #6 T4 chỉ chế độ bắt buộc · #7 423 ở tự đổi (2a396ba) · #8 "spec §3 thắng" (2a396ba) · #9 T2 `git status --porcelain packages/db/migrations` rỗng.

## Lần 4 — 2026-10-01 · READY

Agent: spec-readiness (chỉ đọc; điều phối ghi lại). Lần 3: Cao #1, #2 đã đóng; Thấp #3–#9 đã áp. Không Chặn, không Cao. 7 Thấp — áp ở BUILD (Luật 2), không hỏi người dùng.

### Thấp (áp luôn)
1 T2 lệnh xong thêm `tests/acceptance/ADM-NFR-06/migrate.int.test.ts` · 2 FE1b stub `routes/_authed/tenants/index.tsx`, `routes/_authed/users.tsx` (PageHeader); FE4/FE5 thay · 3 E4 `m1-flow` → FE6, qc sửa §8.1 · 4 T2: `git add` migration trước `db:generate`, kiểm `git diff --quiet` + `ls-files --others` · 5 T2: `.env.local` thiếu `ADMIN_API_DATABASE_URL`/`TEST_ADMIN_API_DATABASE_URL` → thêm giá trị spec §7 · 6 T1 thêm `jose` 6.2.12 vào devDependencies gốc + `bun.lock`; sửa spec §7 · 7 qc: migrate.int M0 sửa cả 4 chỗ + danh sách bảng; smoke bỏ ca logo, ghi lý do. Kèm: T3 lệnh xong thêm `ci-workflow.test.ts`.

Đã áp vào tasks.md ngay sau READY: #1, #2, #3 (phần tasks), #4, ci-workflow (đúng mặc định trên, không chạy lại readiness). Gate: `docs/specs/M1-gate.md` (tự duyệt theo Luật 2b).
