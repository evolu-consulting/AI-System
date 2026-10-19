---
id: N1-pack-frame
title: Khung gói nghiệp vụ dùng chung
milestone: GĐ1 · Luồng A (lõi)
cr: CR-094
status: draft
requirements: [PK-FR-01, PK-FR-02, PK-FR-03, PK-FR-04, PK-FR-05, PK-FR-06, PK-FR-07, PK-FR-08, PK-FR-09, PK-FR-10, PK-BR-01, PK-NFR-01, PK-NFR-02, PK-NFR-03, PK-NFR-04, PK-NFR-05]
design: [docs/platform/intake-hd.md#kế-hoạch-lát, docs/adr/0015-filebox-external-file-storage.md, docs/adr/0016-postgres-source-of-truth.md, docs/adr/0018-single-identity-sso.md, docs/adr/0021-knowledge-service.md, docs/adr/0023-clean-architecture.md]
owner: backend-lead + frontend-lead (khuôn app web gói, D-02)
---

# N1 · Khung gói nghiệp vụ dùng chung

Nguồn: [intake-hd](../../platform/intake-hd.md) lát N1, câu 11/13/14. Gói đầu tiên dùng khung: `contracts` ([HD1](../HD1-contracts-base/spec.md)). Quyết định: chỉ ở [`spec-decisions.md`](spec-decisions.md); ở đây trỏ mã D-xx.

## 1. Phạm vi
| Làm | Không làm (lát nào) |
|---|---|
| Khuôn schema/RLS/FK kép/role/migration cho **mọi** gói | Bảng nghiệp vụ của gói (HD1) |
| Catalog mã quyền gói ở Admin + 3 vai owner/editor/viewer | SSO OIDC (GĐ2), chuyển tài khoản mgmt-app (N5) |
| FileBox `org` theo tenant cho file của gói | Đổi `org` đính kèm Hub/phòng (giữ ADR-0015 D5, xem Q4) |
| Chuyển DOCX → text (thư viện, giới hạn, lỗi) | Trích trường AI (HD2), parse cho RAG (N4, ADR-0021) |
| Bảng + hàm ghi outbox chỉ mục (cùng tx) | Worker nạp OpenSearch, mapping chỉ mục (N4/HD6) |
| Quy ước bốn lớp cho module gói + luật depcruise | Tool gói trong `/mcp` (N2), thông báo (N3) |
| Module gói trong `hub-api` + khung app web `contracts-web` (TF1–TF7: đăng nhập, shell, theme, web-kit, table, harness so ảnh; D-01, D-02) | Màn nghiệp vụ (HD2…), dịch vụ tri thức (N4) |
| — | `POST /pack/<k>/feedback` ⇒ HD5; danh bạ `GET /pack/<k>/members` ⇒ HD5 (code ở `packs/kit`); `TenantState.timezone` ⇒ HD1 |
| Luật giao tiếp nội bộ + đếm bước nhảy (PK-BR-01, PK-NFR-05) | Hạ tầng HA nhiều node (N7) |

## 2. Nghiệp vụ
| Mã | Điều kiện chính xác | Nguồn |
|---|---|---|
| PK-FR-01 | Mỗi gói một **schema Postgres riêng**, tên = khoá gói `^[a-z][a-z0-9_]{1,20}$` (D-05), cấm trùng `public`, `admin`, `hub`, `drizzle`, `packs`, `information_schema`, tiền tố `pg_`. Khoá gói khai một chỗ (hằng trong contract), dùng cho schema, role, mã quyền, `org` không dùng | intake N1 |
| PK-FR-02 | **Mọi bảng** của gói: `tenant_id uuid NOT NULL`; `ENABLE` + `FORCE ROW LEVEL SECURITY`; policy `FOR ALL TO <role gói>` `USING`/`WITH CHECK` `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid` — khuôn `hub.process_timers` (`packages/db/migrations-hub/0036_pd1_durable.sql:92-146`). Bảng cha có `UNIQUE (id, tenant_id)`; mọi FK giữa bảng gói là **FK kép** `(x_id, tenant_id) REFERENCES cha (id, tenant_id)` (0036:113-116). Thiếu `app.tenant_id` ⇒ 0 hàng (không lỗi lộ) | ADR-0016 §1, 0036 |
| PK-FR-03 | **Role DB của gói** `<khoá>_rw`: `NOBYPASSRLS`, không `SUPERUSER`/`CREATEROLE`; quyền chỉ trên schema của gói (`USAGE` + DML bảng cần); **không** quyền trên `admin`, `hub`. Role chủ migration riêng (không dùng role chạy app). Việc nền chạy hệ thống (không có tenant, vd vòng nhắc HD4) đặt `app.tenant_id` từng tenant hoặc lọc `tenant_id` tường minh — khuôn `UnitOfWork` system ([P-d spec-ca §7](../P-d-durable/spec-ca.md)) | ADR-0016 |
| PK-FR-04 | **Migration riêng của gói**: thư mục riêng (vd `packages/db/migrations-<khoá>/`), đánh số từ `0001`, idempotent (`IF NOT EXISTS`, `pg_policies`); `bun run db:migrate` chạy cả gói; test int DB clone mẫu (`test:int:par`) có schema gói | CLAUDE.md lệnh |
| PK-FR-05 | **Catalog mã quyền gói ở Admin**: mã `<khoá>.<việc>` (vd `contracts.read`, `contracts.write`, `contracts.admin`), gán cho **Group** (không gán user lẻ). Bật gói cho tenant ⇒ tạo sẵn 3 Group `owner`/`editor`/`viewer` của gói (Q11) với bộ mã mặc định: viewer = `read`; editor = `read`+`write`; owner = cả ba. Quyền hiệu lực = hợp các Group user thuộc; user `inactive` ⇒ không quyền. Đổi thành viên/gán ⇒ có hiệu lực ≤ 5 s qua `config_changed` (khuôn M3) | intake câu 11, ADR-0018 §2 |
| PK-FR-06 | **FileBox theo tenant** cho file của gói: `org = t_<tenant_id>`; mọi get/link/delete kiểm `org` khớp tenant người gọi (sai ⇒ 404, không lộ tồn tại); link `/d/…` TTL 10', không log URL đầy đủ, không phơi `file_id` ra API gói (chỉ id hàng của gói). Key FileBox như FB1 (env); egress theo ADR-0015 D6 | ADR-0015 "Hardening", intake câu 13 |
| PK-FR-07 | **DOCX → text**: đầu ra Markdown giữ tiêu đề, danh sách, bảng (cần cho chia điều khoản — `reference/mgmt-app-contracts/api/app/contracts/ingest.py:52-54`). PDF/ảnh **không** chuyển, giữ file gốc cho agent (ingest.py:60). Chạy trong module gói (hub-api, D-01); luồng đính kèm/`library` của Hub **không** đổi (giữ PB-R04, CR-062/065). File hỏng/mã hoá/có macro ⇒ lỗi `DOCX_UNREADABLE` (không ném 500); giải nén ≤ 100 MB, ≤ 2.000 phần zip (chống zip bomb); không tải tài nguyên ngoài (ảnh link) | intake N1, rủi ro "đọc DOCX" |
| PK-FR-08 | **Outbox chỉ mục**: bảng `<khoá>.index_outbox` (tenant_id, entity, entity_id, op `upsert`/`delete`, created_at, processed_at); hàm ghi gọi **trong cùng transaction** với thay đổi nghiệp vụ; một lệnh ghi lô = **một** câu INSERT cho cả lô. N1 không có worker đọc outbox | ADR-0016 §2 |
| PK-FR-09 | **Backend gói = module trong `hub-api`** ([D-01](spec-decisions.md)), không app backend mới: `apps/hub-api/src/modules/<khoá>/` theo bốn lớp ADR-0023 §3 (`domain/`, `application/`, `adapters/`), lớp 1–2 chỉ thư viện có sẵn (§2), mapper biên (§4), luật depcruise phủ module gói. Kiểm JWT admin-api bằng JWKS cache (ADR-0018 §1); `tenant_id`/user lấy từ token, **không** từ body/query. Truy cập DB qua role gói (PK-FR-03) — cách nối (pool riêng hay `SET ROLE`) do plan | D-01, ADR-0018, ADR-0021 #1, ADR-0023 |
| PK-FR-10 | **App web của gói** là app riêng (`apps/<khoá>-web`, Rsbuild — intake câu 14), gọi **thẳng** `hub-api`, đăng nhập qua admin-api ([D-02](spec-decisions.md)). Khuôn chung: đăng nhập, shell, i18n, e2e chụp màn hình so với app gốc theo danh sách màn (lệch = lỗi) | D-02 |
| PK-BR-01 | **Giao tiếp nội bộ** ([D-03](spec-decisions.md)): trên đường nóng **không** gọi HTTP đồng bộ giữa app nội bộ (hub-api ↔ admin-api…); đọc dữ liệu app khác qua **role DB chỉ-đọc** (vd quyền/Group từ `admin`), sự kiện qua NOTIFY/Redis (`config_changed`). Ngoại lệ chỉ dịch vụ ngoài (FileBox, AI) | D-03 |

## 3. Contract
Chi tiết từng trường: [plan §2](plan.md). Tóm tắt: `packages/contracts/src/packs.ts` — `PACK_KEY_RE` `^[a-z][a-z0-9_]{1,20}$` (D-05), `PACK_ACTIONS`, `PACK_ROLE_ACTIONS`, `packFeatureKey`/`packGroupKey`; lỗi `PACK_DISABLED` 403, `PACK_FORBIDDEN` 403, `PACK_NOT_FOUND` 404, `DOCX_UNREADABLE` 422, `DOCX_BUSY` 503, file sai tenant ⇒ `NOT_FOUND` 404. Admin: `GET/PUT/DELETE /admin/tenants/:tenant_id/packs[/:pack_key]` (platform admin). Hub: `/pack/<k>/…`, `GET /pack/<k>/me` ⇒ `{pack, enabled, actions}`.

## 4. Dữ liệu
[plan §3](plan.md): cùng database (D-04); `migrations-packs/` (schema `packs`, `packs.install`, `packs.secure_table`) + `migrations-pack-<k>/`; role `<k>_rw` (D-06); bảng khung `<k>.files`, `<k>.index_outbox`; 3 hàng `admin.features` mỗi gói (D-05) do `packs.install` ghi — không migration Admin mới.

## 5. UI
Admin: không màn mới, mã quyền gói hiện trong màn Group/Grants sẵn có (Q6). Khung `contracts-web` (D-02) dựng ở **N1** (TF1–TF7, [plan-frontend](plan-frontend.md)); HD5 chỉ thêm danh sách S03. Nút "Góp ý" ở Shell chỉ mở panel rỗng.

## 6. Hiệu năng (Luật 4c)
| Mã | Ngưỡng | Đo |
|---|---|---|
| PK-NFR-01 | Kiểm quyền gói mỗi request: 0 câu SQL khi cache nóng, ≤ 1 câu khi nguội; thêm p95 ≤ 2 ms | perf int + đếm câu |
| PK-NFR-02 | DOCX → text: file mẫu `reference/mgmt-app-contracts/samples/HD-bao-bi-Minh-Phat.docx` p95 ≤ 300 ms; DOCX 20 MB ≤ 5 s, bộ nhớ đỉnh ≤ 256 MB; zip bomb bị chặn ≤ 1 s | `*.perf.int.test.ts` |
| PK-NFR-03 | Outbox: +1 câu INSERT mỗi lệnh ghi (lô 100 hàng vẫn 1 câu), cùng tx | đếm câu |
| PK-NFR-04 | Cách ly: 2 tenant × mọi bảng khuôn — đọc/sửa/xoá chéo 0 hàng, FK kép chặn gắn chéo tenant, role gói không `SELECT` được `hub.*`/`admin.*` | int RLS |
| PK-NFR-05 | Mỗi request API gói: 0 lời gọi HTTP tới app nội bộ; số bước nhảy (câu DB + lệnh Redis + HTTP) cố định, ghi trong plan cho từng route; perf test đếm và so | perf int đếm bước nhảy |

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Giả lập |
|---|---|
| FileBox | driver mock FB1 (`docs/guides/filebox-test.md`), kiểm `org` |
| admin-api JWKS | khoá dev `bun run keys:dev` |
| Thư viện DOCX | thật (Q3), file mẫu trong `reference/…/samples` |

## 8. Tiêu chí nghiệm thu
| AC | Given / When / Then | Mã |
|---|---|---|
| PK-AC01 | Gói mẫu kiểm thử có 2 bảng cha–con; tenant A ghi 1 hàng, đặt `app.tenant_id`=B ⇒ `SELECT`/`UPDATE`/`DELETE` 0 hàng; không đặt ⇒ 0 hàng | FR-02 |
| PK-AC02 | Hàng con tenant B trỏ cha tenant A ⇒ lỗi FK (23503) | FR-02 |
| PK-AC03 | Role `<khoá>_rw`: `rolbypassrls=false`; `SELECT hub.process_runs` ⇒ 42501 | FR-03 |
| PK-AC04 | `db:migrate` hai lần liên tiếp ⇒ lần 2 không lỗi, không đổi schema | FR-04 |
| PK-AC05 | Bật gói cho tenant ⇒ 3 Group owner/editor/viewer với mã mặc định; user chỉ trong viewer gọi API ghi ⇒ 403 `PACK_FORBIDDEN`; thêm vào editor ⇒ ≤ 5 s được ghi | FR-05 |
| PK-AC06 | Gói chưa bật cho tenant ⇒ mọi API gói 403 `PACK_DISABLED` | FR-05 |
| PK-AC07 | File gói tenant A lưu `org=t_A`; user tenant B xin link bằng id hàng của A ⇒ 404; log không chứa URL `/d/` | FR-06 |
| PK-AC08 | DOCX mẫu ⇒ Markdown có tiêu đề điều khoản + bảng hàng hoá; DOCX hỏng/zip bomb ⇒ `DOCX_UNREADABLE`, không 500 | FR-07 |
| PK-AC09 | Ghi nghiệp vụ + outbox cùng tx; tx rollback ⇒ không còn hàng outbox | FR-08 |
| PK-AC10 | Body có `tenant_id` khác token ⇒ bị bỏ qua, ghi theo tenant token | FR-09 |
| PK-AC11 | depcruise: file `domain/` của module gói import `adapters/` hoặc driver DB ⇒ lỗi | FR-09 |
| PK-AC12 | Gọi một API gói mẫu (đọc + ghi) với bộ đếm ⇒ 0 HTTP tới admin-api; số câu DB/lệnh Redis = số ghi trong plan | BR-01, NFR-05 |

## 9. Câu hỏi mở
Tất cả **đã chốt** (mỗi câu có mặc định, readiness xét): Q1 nơi đặt backend → D-01 · Q2 database, Q8 đọc quyền không HTTP → D-04 · Q3 thư viện DOCX → D-13 (ADR-0024 Accepted) · Q4 org đính kèm Hub → D-07 (chỉ file gói) · Q5 bật gói, Q6 catalog mã quyền → D-05 · Q7 PB-R04 → D-08 · Q9 grant user lẻ → D-11 (hub-api bỏ qua) · Q10 quét chéo tenant → D-12 (HD4, role `<k>_job`).

## 10. Quyết định
[`spec-decisions.md`](spec-decisions.md) — D-01…D-23 (người dùng + backend-lead, FE; mặc định readiness lần 1 cũng ghi ở đó).

## 11. Tranh chấp test
- (không)
