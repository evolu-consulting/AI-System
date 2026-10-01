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
