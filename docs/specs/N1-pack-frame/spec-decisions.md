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
| D-10 | 2026-10-18 · backend-lead (PLAN, Q3) | Đề xuất `fflate` + `saxes` + bộ ghi Markdown tự viết, chạy Bun Worker — [ADR-0024](../../adr/0024-docx-to-markdown.md) **Proposed**, chờ người dùng ở Gate | Q3 mở tới Gate |

## Trong lúc làm (Luật 2)
- (chưa có)
