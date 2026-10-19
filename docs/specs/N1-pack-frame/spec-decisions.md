# Quyết định · N1-pack-frame

Nơi duy nhất ghi quyết định của N1; spec/plan trỏ mã D-xx.

| Mã | Ngày · ai | Quyết định | Hệ quả |
|---|---|---|---|
| D-01 | 2026-10-18 · người dùng | Backend gói hợp đồng **và** dịch vụ tri thức (N4) là **module trong `hub-api`** (schema DB riêng, Clean Architecture ADR-0023); **không** thêm app backend mới | Không cần ADR app mới; PK-FR-09; Q1 đóng; Q2 nghiêng cùng DB Hub |
| D-02 | 2026-10-18 · người dùng | UI gói là **app web riêng** (`contracts-web`), port nguyên giao diện mgmt-app (màn, component, màu, menu, đường dẫn, câu chữ) — khách thấy như cũ; mỗi lát UI có e2e chụp màn hình so với mgmt-app thật theo danh sách màn (lệch = lỗi); thẻ chờ duyệt/nhắc hiện ngay trong màn hợp đồng; trợ lý chung nhúng vào app; app gọi thẳng `hub-api`, đăng nhập qua admin-api | PK-FR-10; app dựng ở HD5 |
| D-03 | 2026-10-18 · người dùng | **Giao tiếp nội bộ:** không gọi HTTP đồng bộ giữa app nội bộ trên đường nóng — đọc qua role DB chỉ-đọc, sự kiện qua NOTIFY/Redis; test perf đếm số bước nhảy (DB/Redis/HTTP) mỗi request | PK-BR-01, PK-NFR-05, Q8 |

| D-04 | 2026-10-18 · backend-lead (PLAN, Q2/Q8) | **Cùng database với Admin/Hub**; quyền gói đọc từ `ConfigCache` hub-api sẵn có (role `hub_ro`, policy SELECT `groups`/`group_members`/`feature_grants`/`feature_entitlements` — `migrations/0004`, `0006`; nạp lại theo `config_changed`). Không role/bảng đọc mới | Q2, Q8 đóng; 0 SQL khi cache nóng (PK-NFR-01) |
| D-05 | 2026-10-18 · backend-lead (PLAN, Q5/Q6) | Mã quyền gói = 3 hàng `admin.features` key `<k'>-read|write|admin` (`k'` = khoá, `_`→`-`) vì CHECK `features_key_check` `^[a-z0-9-]{2,32}$` cấm `.`; mã hiển thị vẫn `<k>.<việc>`. **Bật gói** = entitlement cả 3 (grant cần entitlement từng feature — `grants.rules.ts`), không có feature `pack.<k>` riêng; `PACK_DISABLED` ⇔ thiếu entitlement `<k'>-read`. Route admin-api mới `PUT/DELETE/GET /api/v1/tenants/:id/packs[/:k]` (platform admin) tạo 3 Group + 6 grant. Khoá gói thu về `^[a-z][a-z0-9_]{1,20}$` (vừa 32 ký tự key), cấm thêm `packs`, `information_schema`, `pg_*` | Q5, Q6 đóng; không bảng/màn Admin mới; PK-FR-01 siết |
| D-06 | 2026-10-18 · backend-lead (PLAN) | Role `<k>_rw` `NOINHERIT NOBYPASSRLS`, `GRANT <k>_rw TO hub_api WITH INHERIT FALSE, SET TRUE` (PG16); module gói dùng **pool `hub_api` sẵn có**, mỗi tx một câu `set_config('role', …, true)` + tenant/user. Không pool/login mới | PK-FR-03, PK-FR-09 |
| D-07 | 2026-10-18 · backend-lead (PLAN, Q4) | `org = t_<tenant_id>` chỉ cho file gói (bảng `<k>.files`, CHECK `org = 't_'||tenant_id`); đính kèm Hub/phòng giữ ADR-0015 D5 | Q4 đóng |
| D-08 | 2026-10-18 · backend-lead (PLAN, Q7) | Không mâu thuẫn PB-R04: DOCX → text chỉ trong module gói; gói kiểm thử `pkdemo` (chỉ ngoài production) làm khuôn cho AC01–AC12 | Q7 đóng |
| D-09 | 2026-10-18 · backend-lead (PLAN) | Module gói đặt `apps/hub-api/src/modules/packs/<k>/` + nhân chung `packs/kit/`; 3 luật depcruise `pack-*` (plan §9) | PK-FR-09 |
| D-10 | 2026-10-18 · backend-lead (PLAN, Q3) | Đề xuất `fflate` + `saxes` + bộ ghi Markdown tự viết, chạy Bun Worker — [ADR-0024](../../adr/0024-docx-to-markdown.md) **Accepted** (2026-10-19, D-13) | Q3 đã chốt |
| D-11 | 2026-10-19 · người dùng (Gate N1) | **Q9:** hub-api **bỏ qua** grant user lẻ với mã gói; admin-api giữ contract grants M3 (không chặn ở admin-api) | PK-FR-05; `pack-guard` (plan); test Q9 trong `admin-packs.int.test.ts` |
| D-12 | 2026-10-19 · người dùng (Gate N1) | **Q10:** N1 chỉ có `system(tenantId)`. Quét chéo tenant theo lô (HD4) thêm role `<k>_job` NOBYPASSRLS + policy riêng — **HD4 làm**; không nới policy khuôn | HD4; PK-FR-03 giữ |
| D-13 | 2026-10-19 · người dùng (Gate N1) | **Q3:** [ADR-0024](../../adr/0024-docx-to-markdown.md) **Accepted** — phương án B: `fflate` + `saxes` + bộ ghi Markdown tự viết, Bun Worker | Q3 đóng; T5g cài và ghi bản vào ADR-0024; ca DOCX hết đỏ "PHỤ THUỘC ADR" |
| D-14 | 2026-10-19 · người dùng (Gate N1) | **Font `contracts-web`:** Roboto + Roboto Mono như mgmt-app (`@fontsource`, OFL, tự host như admin-web) — dòng [ADR-0001](../../adr/0001-stack.md) Accepted; Q-F2 đóng | TF2 cài gói; không đổi font |

## Trong lúc làm (Luật 2)
- (chưa có)
