---
id: I1-import
title: Nhập một lần mgmt-app (sohoptac) → Postgres — CLI `mgmt-import`
cr: CR-095
lane: nhanh (Luật 0b); phần tiền/tenant/migration dữ liệu khách có test viết cùng lát, chạy trên bản sao seed (không đụng dữ liệu thật)
depends: N5 (identity-import + N5b scrypt cũ + M1b manager_email), M1D/M1b (visibility org), G1 (bảng đồ thị, đã vào platform/gd0 d374c0bd)
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
| trạng thái xác nhận (status, confirmed_by/at) | contracts.approvals (M3; `contracts.run_id` = lượt, `migrated`) | đã duyệt ⇒ done, chờ xem lại ⇒ level1, lỗi trích ⇒ failed; không run engine |
| contracts: history, parties, origin, cks, auto, file meta | contract_events `mgmt_import` (data) | |
| contract_files/<org>/<hđ>/ | contracts.files + FileBox/dir | sha256 đối soát |
| state `remind:*` | contract_reminders (channel `mgmt_import`) | để HD4 không gửi lại |
| cks_lots / certificates / renewals / signed_docs | cks_lots / cks_certificates / cks_renewals / cks_signed_docs | khách = companies được trỏ tới ⇒ cks_customers |
| market_observations (cks; `*` ⇒ mọi tenant) | cks_market_prices | |
| followups (gia hạn/khách CKS) | cks_followups | còn lại ⇒ vùng chờ |
| obligations / partner_events (+voided) | obligations / partner_events / partner_event_voids | party_key = `contracts.party_key(tên, MST)` |
| documents + chunks | knowledge.documents/chunks | general ⇒ `--knowledge-org`; embedding không chuyển |
| Neo4j Entity/MENTIONS/REL/ALIAS_OF/SIMILAR/CONFLICTS/LINKS_TO | knowledge.entities/chunk_entities/entity_rels/entity_aliases/chunk_links/document_links (G1) | |
| companies, quotes, feedback, score_*, market_scans, chat_files, chats, notifications, catalogs, followups khác, market không-CKS | contracts.legacy_records (0012, nguyên văn jsonb) | chưa có bảng đích |
| Contract/Party/Product/PriceLine (Neo4j) | không chuyển | dẫn xuất từ HĐ (project.py dựng lại) |
| sessions, events, app_logs, llm_usage, entities (vector) | không chuyển | vận hành |

## Việc
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Reader OpenSearch/Neo4j + mapper + SQL lô + use case + CLI | nhanh | xong |
| 2 | Migration 0012 `legacy_records` (sau 0010_m1b, 0011_m3) | nhanh | xong |
| 3 | Unit (luật + reader) + int (`tests/acceptance/I1`, nguồn giả mọi mapper, tiền khớp, luật thấy, chạy lại) | nhanh | xong |
| 4 | Profile `evotest-mgmt` + chạy seed: dry-run → apply → đối soát → chạy lại | nhanh | xong (xem Kết quả) |

## Quyết định trong lúc làm
- D-I1-01: Không đụng dữ liệu sohoptac thật; kiểm trên bản sao seed `evotest-mgmt` (người dùng chọn).
- D-I1-02: Thông báo cũ KHÔNG đi qua `notify.enqueue` (sẽ phát lại email/push) ⇒ vùng chờ.
- D-I1-03: Nguồn sổ `seed`/`rating` ⇒ `action`/`manual` (gốc giữ ở `data.src`); số ngày trễ âm ⇒ null + `data.days_late_raw`.
- D-I1-04: Tiền không nguyên ⇒ null + MONEY_NOT_INT (không làm tròn) — đối soát tổng lệch lộ ra.
- D-I1-05: Bảng chưa có đích ⇒ `contracts.legacy_records` thay vì bỏ (không mất dữ liệu khi tắt mgmt-app).
- D-I1-06: Importer đặt ở `apps/admin-api/src/modules/mgmt-import` (dùng lại N5 cùng app), ghi gói qua pool `hub_api`.
- D-I1-07: Reader xin `accept-encoding: identity` — OpenSearch 2.19 trả mã nén khác gzip cho Bun (mặc định `gzip, deflate, br, zstd`) ⇒ fetch treo tới timeout; mọi phản hồi đọc hết thân, mỗi lời gọi có trần thời gian.
- D-I1-08: Hai org trùng tên ⇒ N5 DUPLICATE_KEY; importer gán `tenant_key` tất định `<slug ≤23>-<8 hex sha256(org id)>` cho org sau (theo id).
- D-I1-10: M3 · HĐ `extracting` ở mgmt-app (đọc dở) ⇒ `extract_failed` + lỗi `MGMT_IMPORT_INTERRUPTED` (trích là job Redis xếp lúc tải lên — HĐ nhập không có job, sẽ kẹt); người dùng trích lại.
- D-I1-09: Phụ lục: `owner_user_id` = chủ HĐ cha (D-M1-03); M1b còn giữ `visibility_owner_id` bằng trigger.

## Kết quả trên bản sao seed (evotest-mgmt, 2026-10-20, mgmt-app b839418; 2 org demo + seed-plus)
- Nguồn: 2 org, 5 user, 45 HĐ, 50 đợt, 434 sự kiện sổ, 12 lô, 32 chữ ký, 142 văn bản ký, 28 công ty, 35 giá thị trường, 1 tài liệu + 2 đoạn, đồ thị 2 thực thể/4 MENTIONS/1 REL/1 SIMILAR (+137 cạnh đồ thị HĐ — dẫn xuất, không chuyển).
- Apply (sau M3): 1.022 hàng / 23 bảng (gồm 45 lượt duyệt `contracts.approvals`); chạy lại: **0** hàng chèn (idempotent). Tiền 8 khoá × 2 tenant khớp **tuyệt đối** nguồn = kế hoạch = đích (vd HĐ 3.558.150.000 ₫, đợt 1.237.250.000 ₫, sổ 485.250.000 ₫).
- File 1/1 sha256 khớp; văn bản ký sha 142/142; so trường 95 bản ghi, 0 lệch; luật thấy 5/5 user khớp mgmt-app (RLS thật M1/M1b).
- Thời gian (importer): dry 1,8 s · apply 0,9 s · chạy lại 0,7 s; cả lượt (build + seed + migrate + 3 lần) 115 s. Int: 16 pass (I1 6 + N5 10).

## Còn lại cho cutover thật
- Chép chỉ-đọc volume `apidata/contract_files` + quyền đọc OpenSearch/Neo4j của sohoptac; FileBox sink chưa nối vào CLI (hiện `--sink-dir`); `--source mgmt-prod`, `--knowledge-org`.
- TECH-DEBT #224 (giới hạn đăng nhập) trước khi nhập hash thật; tenant trùng khoá với tenant đã có ⇒ N5 ORG_KEY_TAKEN — đặt `tenant_key` tay.
- Vùng chờ `legacy_records` (công ty, báo giá, góp ý, chấm điểm, chat, thông báo…) cần lát đích riêng; embedding phải dựng lại (N4).
- Đóng băng ghi mgmt-app trong lúc chạy (đọc là ảnh chụp, không đồng bộ tăng dần).