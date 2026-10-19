# Readiness · N1-pack-frame

## Lần 1 · 2026-10-19 · spec-readiness

## Kết luận: NOT READY
Phạm vi đã kiểm: `docs/specs/N1-pack-frame/` · 9 file đã đọc (spec, spec-decisions, plan, plan-frontend, test-plan, tasks, ADR-0024, intake-hd §N1, HD1 plan §7) + đối chiếu code (`admin-api/src/app.ts`, `hub-api/src/modules/config/*`, `migrations/0005`, `0011`, `migrations-hub/0000`, `0036`, `migrate-hub.ts`, `test-db-template.ts`) · mã yêu cầu: PK-FR-01…10, PK-BR-01, PK-NFR-01…05, PK-AC01…12

Không có lỗ hổng Chặn. Không có lỗ hổng cách ly tenant/RLS thiếu mặc định an toàn (FORCE RLS không nhánh system, FK kép, role NOBYPASSRLS/NOINHERIT `SET TRUE`, `org` CHECK ở DB, Q9 bỏ qua grant lẻ, Q10 không nới policy — đều an toàn). Còn 10 Cao, mỗi mục có mặc định; phiên chính áp theo Luật 2b rồi chạy vòng 2 (chỉ diff).

## Lỗ hổng
| # | Mức | Mục | Vị trí | Vấn đề | Mặc định đề xuất |
|---|-----|-----|--------|--------|------------------|
| 1 | Cao | B, I | spec.md:44, plan.md:46-51, test-plan.md:61 (T1) | Route Admin ghi `/api/v1/tenants/:tenant_id/packs`, nhưng admin-api không có `/api/v1`, mọi route mount `/admin/*` (`apps/admin-api/src/app.ts:83-84` mount `/admin/tenants`; entitlement ở `/admin/features/:id/entitlements/:tenant_id`) | Theo code: `GET /admin/tenants/:tenant_id/packs`, `PUT/DELETE /admin/tenants/:tenant_id/packs/:pack_key`, router `packsRoutes` mount thêm dưới `/admin/tenants` cạnh `tenantsRoutes`; sửa spec §3 + plan §2; qc đổi `ADMIN_PACKS_BASE` + relock |
| 2 | Cao | J, F | test-plan.md:62; plan.md:131 | Seam DI cho test chưa có trong plan: cách bật `pkdemo` và cấu hình FileBox của gói trong `createApp(cfg, deps)` | `AppDeps.packs?: { pkdemo?: boolean; filebox?: { url: string; token: string } }`; vắng ⇒ `pkdemo = APP_ENV !== "production"`, filebox từ env FB1; `packs.mount.ts` đọc `deps.packs` |
| 3 | Cao | B, J | test-plan.md:63; plan.md:129,144-145 | Body/response `pkdemo` không có schema (trường, giới hạn, lỗi) dù là khuôn AC01–AC12 | Lấy giả định qc: `POST /pack/pkdemo/items` `{title: string 1–200, lines: {text: string 1–200}[] ≤ 100}` ⇒ 201 `{id, title, lines:[{id,text}]}`; `GET /pack/pkdemo/items/:id` ⇒ 200 cùng hình / 404 `NOT_FOUND`; sai ⇒ 400 `VALIDATION_ERROR` (`API_ERRORS`); quyền: GET cần `read`, POST cần `write`; schema đặt trong `pkdemo/adapters/pkdemo.routes.ts` (không vào `@ai/contracts`, chỉ ngoài production) |
| 4 | Cao | H2, J | plan.md:109; test-plan.md:64 | `packActionsFor(…)` chưa có chữ ký ⇒ qc không viết được unit | `packActionsFor(i: { entitled: boolean; featureOff: boolean; userGroupIds: ReadonlySet<string>; grantedByAction: Readonly<Record<PackAction, readonly string[]>> }): PackAction[]` — `!entitled \|\| featureOff` ⇒ `[]`; còn lại các action có giao Group ≠ ∅, thứ tự `PACK_ACTIONS` |
| 5 | Cao | J | plan.md:117,128; test-plan.md:65 | Tên xuất adapter DOCX + vòng đời worker chưa ghi | `kit/adapters/docx/index.ts` xuất `createDocxConverter(opts?: { maxPending?: number /*2*/; timeoutMs?: number /*10_000*/ }): DocxConverter & { close(): Promise<void> }` (đúng giả định qc); `packs.mount.ts` gọi `close()` khi `signal` abort |
| 6 | Cao | K, F | test-plan.md:67; plan.md:111 | Không có tín hiệu "đã nạp lại cấu hình" ⇒ test AC05/AC06 "≤ 5 s" phải chờ gián tiếp (`hubActivity`), sát ranh giới Luật 4c "không poll" | T5b thêm `ConfigCache.reloaded(minAdminVersion?: number): Promise<number>` (resolve khi `#loadAdmin` xong với version ≥ tham số); test `await` nó; không đổi hành vi nạp lại |
| 7 | Cao | B | plan.md:46-51; test-plan.md:21,68 | Bảng route Admin thiếu mã lỗi: khoá gói sai/cấm, tenant không tồn tại, quyền; DELETE gói chưa cài | Khoá không qua `PackKeySchema` ⇒ 400 `VALIDATION_ERROR`; tenant không có ⇒ 404 `NOT_FOUND`; gói chưa cài (PUT/DELETE) ⇒ 404 `PACK_NOT_FOUND`; không phải platform admin ⇒ 403 `FORBIDDEN`, không token ⇒ 401 (như `/admin/features/:id/entitlements`); DELETE khi đã tắt ⇒ 204 idempotent, không audit |
| 8 | Cao | A, B | plan-frontend.md:100,111; plan-frontend.md:84 | FE cần `POST /pack/feedback` (S14), plan backend N1 không có; nút "Góp ý về app" nằm trong Shell N1 (TF5) | Không thuộc N1: route theo gói `POST /pack/<k>/feedback` + bảng trong schema gói làm ở **HD5** (Q-F5); N1 Shell chỉ có nút mở panel rỗng (không gửi); ghi vào spec §1 "Không làm" và plan-frontend §9 |
| 9 | Cao | A | `docs/specs/HD1-contracts-base/plan.md:105-116` (N1-a, N1-c) | HD1 cần từ N1: `TenantState.timezone` trong ConfigCache (cột `admin.tenants.timezone` có từ `migrations/0011`, `TenantState` hiện chỉ `{id, active, maxConcurrentSub}` — `config.rules.ts:8`) và danh bạ `GET /pack/<k>/members` (cần tên user; `UserState` không có tên). HD1 plan tự mâu thuẫn (dòng 110 "HD5" ↔ Q8 dòng 116 "N1 T5") | **N1-a ⇒ HD1** (task HD1 sửa `config.repo.ts`/`config.rules.ts` thêm `timezone`, test đi kèm; N1 không mở lại test đã khoá). **N1-c ⇒ HD5** (đặt code ở `packs/kit` để gói khác dùng lại, task + test thuộc HD5 — consumer đầu tiên). Ghi cả hai vào spec N1 §1 cột "Không làm"; HD1 sửa Q8 cho khớp |
| 10 | Cao | I, A | spec.md:50 ↔ plan-frontend.md:107 (Q-F1), tasks.md:22-28 | Spec §5 nói `contracts-web` dựng ở HD5, nhưng plan-frontend + tasks dựng khung ở N1 (TF1–TF7) | Theo Q-F1: khung (đăng nhập, shell, theme, web-kit, table, harness so ảnh) ở **N1**; HD5 chỉ thêm danh sách S03; sửa spec §5 + thêm vào §1 "Làm" |
| 11 | Thấp | L | spec.md (12.534 B) | Vượt trần 12 KB (12.288 B) 246 B | Cắt văn xuôi/lặp: §9 bỏ các câu đã chốt (chỉ trỏ D-xx) |
| 12 | Thấp | L, I | spec.md:99 | §10 ghi "D-01…D-03" nhưng `spec-decisions.md` có D-01…D-10 | Sửa "D-01…D-10" |
| 13 | Thấp | L | plan-frontend.md:5-12, 104-111 | Quyết định F1–F5, Q-F1/Q-F3/Q-F4/Q-F5 nằm ngoài `spec-decisions.md` | Chuyển thành D-11… trong `spec-decisions.md`, plan-frontend trỏ mã |
| 14 | Thấp | I | spec.md:64, tasks.md:17 | Trỏ `guides/filebox-test.md`, file thật ở `docs/guides/filebox-test.md` | Sửa đường dẫn |
| 15 | Thấp | D | plan.md:39 | `admin.features.status` có `beta` (`0001_admin_identity.sql:15`), plan chỉ nói `off` | `beta` coi như `on` (`featureOff = status === 'off'`) |
| 16 | Thấp | D | plan.md:103 | Tenant đã tự tạo Group key `<k'>-owner…` trước khi bật gói ⇒ `ON CONFLICT DO NOTHING` dùng lại Group đó và cấp mã gói | Chấp nhận (tenant_admin vốn quản thành viên Group); ghi một dòng trong plan §5 |
| 17 | Thấp | K | plan.md:92; tasks.md:12 | `test-db-template.ts` thêm `runPackMigrations` ⇒ thời gian dựng DB mẫu tăng, chưa có bước đo trước/sau | T5a ghi thời gian dựng mẫu trước → sau vào báo cáo task |
| 18 | Thấp | F | test-plan.md:29 | Ca rollback dùng "constraint trigger hoãn ở COMMIT" — cơ chế không có trong DDL plan | Trigger chỉ tạo trong test (SQL owner), không vào migration `pkdemo`; ghi rõ ở test-plan |
| 19 | Thấp | H | tasks.md:26 ↔ test-plan.md:3 | TF5 `Rủi ro` = thường, test-plan coi TF5 rủi ro cao | Giữ `thường` (Shell không chạm auth/quyền), sửa câu test-plan:3 |
| 20 | Thấp | F | test-plan.md:66 | `PackFiles.put/remove` không có route N1 ⇒ chỉ thử qua SQL owner + `fb.put` | Chấp nhận; route upload/xoá do HD1+ |
| 21 | Thấp | F | test-plan.md:80 | e2e N1 chưa chạy được (app chưa có; `playwright --list` lỗi môi trường cả `e2e/chat`) | Chạy lại sau TF1; lỗi môi trường ghi TECH-DEBT nếu còn |

## Mâu thuẫn giữa tài liệu
- spec §3/plan §2 `/api/v1/tenants/…` ↔ code `/admin/tenants` (`app.ts:83-84`) → giữ code (#1).
- spec §5 "dựng ở HD5" ↔ plan-frontend Q-F1 + tasks TF1–TF7 ở N1 → giữ N1 (#10).
- HD1 plan §7 N1-c "HD5" ↔ HD1 Q8 "N1 T5" → giữ HD5 (#9).
- plan-frontend §9 cần `POST /pack/feedback` ↔ plan backend không có, Q-F5 gán HD5 → giữ HD5 (#8).

## Câu hỏi cho người dùng (chỉ những gì KHÔNG có mặc định an toàn)
Không có câu hỏi mới. Chờ người dùng ở Gate (đã trình, không tính là lỗ hổng mới): ADR-0024 / Q3 (`fflate` + `saxes`), Q9 (grant user lẻ: hub-api bỏ qua), Q10 (quét chéo tenant: role `<k>_job` ở HD4), Q-F2 (font Roboto/Roboto Mono vào ADR-0001).

## Checklist
| Mục | Kết quả | Bằng chứng |
|-----|---------|------------|
| A Phạm vi | Thiếu | spec.md:16-26 có bảng làm/không làm; thiếu feedback (#8), N1-a/N1-c (#9), khung FE (#10) |
| B Hợp đồng | Thiếu | plan.md:15-54 (contract, lỗi, `/me`); thiếu đường dẫn đúng (#1), lỗi Admin (#7), body pkdemo (#3) |
| C Dữ liệu | Đạt | plan.md:56-94 (DDL, CHECK, index, FK kép, RLS FORCE, role, runner, guard); `groups_tenant_key_uq` có thật (`0005:64`) |
| D Nghiệp vụ | Đạt | spec.md:31-41, plan.md:37-44, 103-111; edge Thấp #15, #16 |
| E UI | Đạt | plan-frontend.md:14-25, 80-89 (trạng thái, nhãn VI/EN); N1 không có màn nghiệp vụ |
| F Kiểm chứng | Thiếu | test-plan.md:17-49 (mọi AC có ca, dữ liệu, lệnh); thiếu seam/tín hiệu (#2, #6) |
| G Phụ thuộc & môi trường | Đạt (chờ Gate) | spec.md:61-66; FileBox giả FB1, JWKS dev; thư viện DOCX chờ ADR-0024 |
| H2 Vai trò | Thiếu | plan/plan-frontend/test-plan đủ; `packActionsFor` thiếu chữ ký (#4) |
| H Task | Đạt | tasks.md:7-28 (file, phụ thuộc, lệnh xong, `Rủi ro`); Thấp #19 |
| I Nhất quán | Mâu thuẫn | #1, #9, #10, #12 |
| J Độ chính xác | Thiếu | #2–#5, #7 |
| K Hiệu năng | Đạt | spec.md:52-59 (ngưỡng có số), plan.md:139-156 (bước nhảy mỗi route, số câu, không unnest, không khoá/sleep), test-plan.md:44-49 (perf + đếm câu); Thấp #17; #6 thuộc kiểm chứng |
| L Gọn | Thiếu (Thấp) | spec 12.534 B > 12.288 (#11); plan 18.424 ≤ 18.432; plan-frontend 15.321 ≤ 15.360; test-plan 12.702 ≤ 18.432; quyết định ngoài `spec-decisions.md` (#13); không có `*-addendum.md` |

## Quét từ mơ hồ
≈ 40 kết quả, hầu hết là dấu `…` trong dải mã (T5a…T5g, FR-01…10), "khoảng trắng", "nên" trong câu mô tả — vô hại. Ghi thành lỗ hổng: `packActionsFor(…)` (#4), "D-01…D-03" (#12).

## Chưa kiểm
`reference/mgmt-app-contracts/**` (nguồn UI, tham chiếu dòng của plan-frontend), nội dung `tests/acceptance/N1/**` và `e2e/N1/**` (chỉ đối chiếu test-plan), ADR-0015/0016/0018/0021/0023 ngoài các mục spec trỏ.

## Lần 2 · 2026-10-19 · spec-readiness (vòng cuối, chỉ diff a8d097b..HEAD = 2f98a5c + 5456432)

## Kết luận: READY
Không còn Chặn/Cao. Đã đóng Cao #1–#10 và Thấp #11–#21 (mặc định ghi ở `spec-decisions.md` mục "Mặc định readiness lần 1"; D-11…D-23). Không phát sinh lỗ hổng mới.

**Điều kiện trước build (không tính NOT READY):** `tests/acceptance/N1/_support/n1.ts` — `ADMIN_PACKS_BASE` trong HEAD vẫn `"/api/v1/tenants"`; working tree đã sửa thành `"/admin/tenants"` nhưng chưa commit. qc commit + relock (`bun run test:lock:verify`) trước khi T5b build.

| # | Kết quả | Bằng chứng |
|---|---------|------------|
| 1 | Đóng spec/plan/test-plan; chờ qc commit hằng (điều kiện trước build) | plan.md:46, test-plan.md:61, tasks.md:13 |
| 2 | Đóng | plan.md:127, test-plan.md:62 |
| 3 | Đóng | plan.md:152, test-plan.md:63 |
| 4 | Đóng | plan.md:104-105, test-plan.md:64 |
| 5 | Đóng | test-plan.md:65, plan §7 (`createDocxConverter` + `close()`) |
| 6 | Đóng | test-plan.md:67, tasks.md:13 (`ConfigCache.reloaded`) |
| 7 | Đóng | plan.md:46 (400/404/404 `PACK_NOT_FOUND`/403/401) |
| 8 | Đóng | spec.md:26, spec.md:51, plan-frontend.md:94, D-23 |
| 9 | Đóng | spec.md:26, HD1 plan §7 N1-a/N1-c + Q8 khớp (HD1 tự thêm timezone; members ⇒ HD5) |
| 10 | Đóng | spec.md:25, 51, D-20; tasks TF1–TF7 |
| 11 | Đóng | spec.md 11.800 B ≤ 12.288 |
| 12 | Đóng | spec.md:89 "D-01…D-23" |
| 13 | Đóng | spec-decisions.md D-14…D-23; plan-frontend.md:6, 99 chỉ trỏ mã |
| 14 | Đóng | spec.md:65 `docs/guides/filebox-test.md` (tasks.md:17 còn dạng ngắn `guides/…` — vô hại) |
| 15 | Đóng | plan.md:32, 62 (`beta` coi như `on`) |
| 16 | Đóng | spec-decisions.md ghi chú #16; plan.md:107 |
| 17 | Đóng | tasks.md T5a, test-plan.md:68 |
| 18 | Đóng | test-plan.md:29 |
| 19 | Đóng | test-plan.md:3 (TF5 `thường`) |
| 20 | Đóng (chấp nhận) | test-plan.md:66 |
| 21 | Mở (Thấp, theo kế hoạch) | test-plan.md:80: chạy lại e2e sau TF1; lỗi môi trường ghi TECH-DEBT khi build |

Quyết định Gate (2f98a5c): ADR-0024 `Accepted` (adr/0024:3); Q9/Q10 = D-11/D-12; font Roboto = D-14 + dòng ADR-0001:31; test-plan.md:72 cập nhật 22 ca DOCX. Không mâu thuẫn giữa D-11…D-14 và plan.

Checklist K/L: K Đạt (plan.md:137-152 giữ nguyên, T5a thêm đo DB mẫu). L Đạt: spec 11.800 ≤ 12.288 · plan 18.388 ≤ 18.432 · plan-frontend 13.560 ≤ 15.360 · test-plan 13.127 ≤ 18.432; quyết định chỉ ở `spec-decisions.md`; không có `*-addendum.md`. (plan còn dư 44 B: mọi sửa plan phải cắt tương ứng.)

Thấp còn mở: #21 (sửa khi build). Chưa kiểm: nội dung `tests/acceptance/N1/**`, `e2e/N1/**` ngoài hằng `ADMIN_PACKS_BASE`.
