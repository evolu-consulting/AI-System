---
id: I1-import
title: Nhập một lần mgmt-app (sohoptac) → Postgres — CLI `mgmt-import`
cr: CR-095
lane: nhanh (Luật 0b); phần tiền/tenant/migration dữ liệu khách có test viết cùng lát, chạy trên bản sao seed (không đụng dữ liệu thật)
depends: N5 (identity-import + N5b scrypt cũ), M1D (visibility org), G1 (slice/g1-graph — bảng đồ thị, CHƯA merge)
---
# I1 · mgmt-import (plan ngắn)

**Nguồn (chỉ đọc):** OpenSearch (REST scroll, bỏ `embedding`) + Neo4j (HTTP `/db/neo4j/tx/commit`, chỉ MATCH) — không thêm thư viện.
**Đích:** `admin_api` (N5) + `hub_api` → `withPackScope` (`contracts_rw` / `knowledge_rw`, RLS FORCE). Không dùng role chủ.
**Idempotent:** id = uuid v5(nguồn, loại, id mgmt); mọi câu `ON CONFLICT DO NOTHING`; bảng id bigint (sổ đối tác, sự kiện HĐ) khoá
`data.mgmt_id`/`(contract,type)` qua `NOT EXISTS`. **Lô:** mỗi bảng × tenant × lô = 1 tx + 1 câu (JSON 1 tham số). **Chạy tiếp:**
`--state checkpoint.json` (lô đã xong bỏ qua) + chạy lại vô hại. **Dry-run mặc định.**

## Bảng ánh xạ
| mgmt-app | Đích | Ghi chú |
|---|---|---|
| orgs, users, memberships | admin.tenants/users/groups (N5 `runIdentityImport`) | hash `scrypt$…` ⇒ `$scrypt-legacy$` (N5b); `manager_email` ⇒ admin.user_managers (adapter mỏng, thay bằng M1b) |
| — | contracts.visibility_settings `org` | D-M1-01 |
| catalogs.categories / assign / aliases | contract_categories; item.category_id theo product key | |
| contracts (+fields {value,quote,verified,edited}, items, clauses, warnings, handled) | contracts, contract_items | addendum ⇒ appendix, chủ = chủ HĐ cha (D-M1-03) |
| contracts: history, parties, origin, cks, auto, file meta | contract_events `mgmt_import` (data) | |
| contract_files/<org>/<hđ>/ | contracts.files + FileBox/dir | sha256 đối soát |
| state `remind:*` | contract_reminders (channel `mgmt_import`) | để HD4 không gửi lại |
| cks_lots / certificates / renewals / signed_docs | cks_lots / cks_certificates / cks_renewals / cks_signed_docs | khách = companies được trỏ tới ⇒ cks_customers |
| market_observations (cks; `*` ⇒ mọi tenant) | cks_market_prices | |
| followups (gia hạn/khách CKS) | cks_followups | còn lại ⇒ vùng chờ |
| obligations / partner_events (+voided) | obligations / partner_events / partner_event_voids | party_key = `contracts.party_key(tên, MST)` |
| documents + chunks | knowledge.documents/chunks | general ⇒ `--knowledge-org`; embedding không chuyển |
| Neo4j Entity/MENTIONS/REL/ALIAS_OF/SIMILAR/CONFLICTS/LINKS_TO | knowledge.entities/chunk_entities/entity_rels/entity_aliases/chunk_links/document_links (G1) | bỏ qua có báo nếu DB chưa có G1 |
| companies, quotes, feedback, score_*, market_scans, chat_files, chats, notifications, catalogs, followups khác, market không-CKS | contracts.legacy_records (0010, nguyên văn jsonb) | chưa có bảng đích |
| Contract/Party/Product/PriceLine (Neo4j) | không chuyển | dẫn xuất từ HĐ (project.py dựng lại) |
| sessions, events, app_logs, llm_usage, entities (vector) | không chuyển | vận hành |

## Việc
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Reader OpenSearch/Neo4j + mapper + SQL lô + use case + CLI | nhanh | xong |
| 2 | Migration 0010 `legacy_records` | nhanh | xong |
| 3 | Unit (luật + reader) + int (`tests/acceptance/I1`, nguồn giả mọi mapper, tiền khớp, luật thấy, chạy lại) | nhanh | xong |
| 4 | Profile `evotest-mgmt` + chạy seed: dry-run → apply → đối soát → chạy lại | nhanh | xem dưới |

## Quyết định trong lúc làm
- D-I1-01: Không đụng dữ liệu sohoptac thật; kiểm trên bản sao seed `evotest-mgmt` (người dùng chọn).
- D-I1-02: Thông báo cũ KHÔNG đi qua `notify.enqueue` (sẽ phát lại email/push) ⇒ vùng chờ.
- D-I1-03: Nguồn sổ `seed`/`rating` ⇒ `action`/`manual` (gốc giữ ở `data.src`); số ngày trễ âm ⇒ null + `data.days_late_raw`.
- D-I1-04: Tiền không nguyên ⇒ null + MONEY_NOT_INT (không làm tròn) — đối soát tổng lệch lộ ra.
- D-I1-05: Bảng chưa có đích ⇒ `contracts.legacy_records` thay vì bỏ (không mất dữ liệu khi tắt mgmt-app).
- D-I1-06: Importer đặt ở `apps/admin-api/src/modules/mgmt-import` (dùng lại N5 cùng app), ghi gói qua pool `hub_api`.
