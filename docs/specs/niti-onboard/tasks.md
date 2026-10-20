---
id: niti-onboard
title: Tenant thật đầu tiên NitiGroup — onboarding lặp lại được + nhập sohoptac (I1) vào tenant
cr: CR-095
lane: đầy đủ cho phần tenant/RLS/migration dữ liệu khách (test int viết cùng lát, chạy trên bản sao seed — không đụng dữ liệu thật); UI hồ sơ: nhanh
depends: M1 (phòng ban), N1 (gói, pk-enable trợ lý), N5 + I1 (importer), admin 0014
---
# niti-onboard (plan ngắn)

Người dùng (2026-10-20): khách đầu tiên của app mới (AI System + gói contracts, thay sohoptac) là **CÔNG TY TNHH THƯƠNG MẠI DỊCH
VỤ NITIGROUP** (MST 0318938091). Dữ liệu sohoptac cũ chép vào tenant này.

- **Dữ liệu khai báo:** `deploy/tenants/nitigroup.yaml` (hồ sơ, 1 gốc + 22 phòng, gói, gắn org importer).
- **CLI** `apps/admin-api/src/modules/tenant-onboard/tenant-onboard.cli.ts` — một tx `configWrite` (tenant + hồ sơ + marker + Group
  phòng ban vi/en + cây + thành viên/trưởng phòng theo email) rồi `enablePack` mỗi gói (entitlement + 3 Group vai + grant + trợ lý
  `mgmt-assistant` qua `packs.grant_agents`). Không đổi ⇒ không ghi, không audit, không tăng version.
- **Migration admin 0015** `0015_niti_tenant_profile`: `tenants.profile jsonb` (`{}` mặc định, ≤ 8 KB) + `departments.parent_group_id`
  (FK cùng tenant, xoá cha ⇒ null) + `sort_order`. Chỉ cộng thêm. admin-web: thẻ "Hồ sơ công ty" ở tab Thông tin (chỉ đọc).
- **Importer** `mgmt-import --into-tenant <key>`: chỉ nhập org đã gắn với tenant (marker `settings.mgmt_source/mgmt_org_id` do
  onboarding đặt); org khác bị loại (không tạo tenant/user), báo `excluded` + `source_orgs`.

## Việc
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Migration 0015 + schema Drizzle + contract `TenantProfileSchema` (chi tiết tenant trả `profile`) | đầy đủ | xong |
| 2 | Module `tenant-onboard` (rules + repo SQL theo tập + use case + CLI) + `deploy/tenants/nitigroup.yaml` | đầy đủ | xong |
| 3 | Importer `--into-tenant` (scopeToOrg, `source_orgs`, `excluded`, `into.TENANT_NOT_BOUND`) | đầy đủ | xong |
| 4 | Unit (rules onboarding + file NitiGroup thật, scopeToOrg, dòng hồ sơ admin-web) + int `tests/acceptance/NITI/onboard.int.test.ts` | đầy đủ | xong (xem Kết quả) |
| 5 | evotest-mgmt: `run.ps1 -Tenant nitigroup` (onboarding ×2 + dry-run/apply/chạy lại `--into-tenant`) | đầy đủ | xong (xem Kết quả) |
| 6 | admin-web thẻ hồ sơ | nhanh | xong (chưa có e2e — xem Còn lại) |

## Thứ tự chạy production — stack `sohoptac2` (KHÔNG chạy trong lát này)
Kit `deploy/prod-sohoptac2/` (gd0 8b7571c2): máy `evoc@149.202.83.5`, thư mục `~/workspace/sohoptac2`, project Docker `sohoptac2`
(service `pg` owner `s2_owner` DB `ai_system`; lệnh một lần = service `tool`, entrypoint `bun --env-file=/run/s2/app.env`, role
`admin_api`/`hub_api` NOBYPASSRLS từ `.env`). sohoptac cũ = project Docker `sohoptac` (mgmt-app compose: `opensearch` :9200,
`neo4j` :7474/7687, volume `sohoptac_apidata` → `/app/data/contract_files`) — chỉ **ĐỌC** (REST scroll + Cypher MATCH, mount `:ro`).
Mọi lệnh dưới chạy trên máy chủ: `cd ~/workspace/sohoptac2; dc() { docker compose -p sohoptac2 "$@"; }`.

1. **Deploy** (máy dev): `powershell -File deploy/prod-sohoptac2/deploy.ps1 -Ref platform/gd0` (gd0 đã merge lát này) — `setup.sh`
   migrate áp admin 0015. Kiểm:
   `dc exec -T pg psql -U s2_owner -d ai_system -Atc "select (select count(*) from admin.features where key like 'contracts-%'), (select count(*) from hub.agents where key='mgmt-assistant'), (select count(*) from information_schema.columns where table_schema='admin' and table_name='tenants' and column_name='profile')"`
   ⇒ `3|1|1`.
2. **Actor:** `ACTOR=$(dc exec -T pg psql -U s2_owner -d ai_system -Atc "select id from admin.users where role='platform_admin' and username='admin'")`.
3. **Onboarding (chưa gắn org):**
   `dc run --rm -T -v "$PWD/build/deploy/tenants:/app/deploy/tenants:ro" tool apps/admin-api/src/modules/tenant-onboard/tenant-onboard.cli.ts --file deploy/tenants/nitigroup.yaml --actor "$ACTOR" > onboard1.json`
   ⇒ `tenant.created=true`, `departments.total=23`, `packs=[{contracts,3}]`. Chạy lại ⇒ `created/updated=false`, mọi số đổi = 0.
4. **Nối nguồn chỉ-đọc** (chỉ xem, không đổi gì ở sohoptac): `docker ps --filter name=sohoptac- --format '{{.Names}} {{.Ports}}'`
   (cần `sohoptac-opensearch-1` có `0.0.0.0:9200`, `sohoptac-neo4j-1` có `0.0.0.0:7474`); mật khẩu Neo4j:
   `export MGMT_NEO4J_PASSWORD=$(docker inspect sohoptac-neo4j-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's#^NEO4J_AUTH=neo4j/##p')`.
   Lệnh importer chung (container một lần trên mạng `sohoptac2_default` để thấy `pg`; nguồn qua cổng host; file `:ro`):
   ```
   mkdir -p import-out
   IMP=(docker run --rm -i --user "$(id -u):$(id -g)" --network sohoptac2_default --add-host host.docker.internal:host-gateway
     -v "$PWD/.env:/run/s2/app.env:ro" -v sohoptac_apidata:/mgmtdata:ro -v "$PWD/import-out:/out"
     -e MGMT_OPENSEARCH_URL=http://host.docker.internal:9200 -e MGMT_NEO4J_URL=http://host.docker.internal:7474
     -e MGMT_NEO4J_USER=neo4j -e MGMT_NEO4J_PASSWORD
     sohoptac2-app:latest bun --env-file=/run/s2/app.env apps/admin-api/src/modules/mgmt-import/mgmt-import.cli.ts
     --source mgmt-prod --actor "$ACTOR" --into-tenant nitigroup --files-dir /mgmtdata/contract_files --sink-dir /out/sink)
   ```
5. **Tìm org sohoptac:** `"${IMP[@]}" --report /out/dry0.json > /dev/null` ⇒ exit 2 `into.TENANT_NOT_BOUND` (dry-run rỗng); đọc
   `jq .source_orgs import-out/dry0.json` (id, tên, số thành viên). **> 1 org ⇒ dừng, hỏi người dùng** (lát này nhập MỘT org — D-NO-05).
6. **Gắn org:** điền `import.org_id` trong `deploy/tenants/nitigroup.yaml` (commit + deploy) hoặc chạy lại bước 3 thêm
   `--mgmt-org <id>` ⇒ `binding.state = "set"` (lần sau `kept`; đổi org ⇒ `ORG_REBIND`).
7. **Đóng băng ghi sohoptac** (báo người dùng; importer đọc ảnh chụp, không đồng bộ tăng dần).
8. **Import dry-run:** `"${IMP[@]}" --knowledge-org <org id> --report /out/dry.json > /dev/null; echo $?` ⇒ 0 (2 = có vấn đề: đọc
   `issues_by_code`, `identity`, `excluded`, `tables.*.planned` — lạ ⇒ dừng).
9. **Import apply:** `"${IMP[@]}" --knowledge-org <org id> --apply --state /out/checkpoint.json --report /out/apply.json > /dev/null`
   (đứt ⇒ chạy lại đúng lệnh, cùng `--state`).
10. **Đối soát:** `jq '{money_ok: .reconcile.money_ok, money: .reconcile.money, files: .reconcile.files, signed: .reconcile.signed_sha, diffs: (.reconcile.diffs|length), vis: .reconcile.visibility, into, excluded}' import-out/apply.json`
    ⇒ `money_ok=true` (nguồn = kế hoạch = đích, tuyệt đối), `files.checksum_ok = found`, `signed.ok`, `diffs=0`,
    `vis.mismatches=[]`; chạy lại bước 9 với `--report /out/rerun.json` ⇒ tổng `tables.*.inserted = 0`. So tay vài HĐ/sổ trên
    contracts-web (tunnel :18431) với sohoptac.
11. **Phòng ban:** sohoptac KHÔNG có phòng ban (mgmt-app `orgs.py` chỉ role + `manager_email`, đã nhập qua N5/M1b) ⇒ điền
    `head`/`members` (email) trong yaml, chạy lại bước 3 (`pending_emails` = email chưa có user), hoặc gán ở contracts-web Cài đặt › Phòng ban.
12. **Chặn trước khi mở đăng nhập/cutover:** FileBox sink chưa nối vào CLI (`--sink-dir` chỉ là thư mục — file HĐ chưa vào FileBox,
    I1 "Còn lại"); TECH-DEBT #224 (giới hạn đăng nhập).

## Quyết định trong lúc làm
- D-NO-01: Hồ sơ = cột `admin.tenants.profile jsonb` (không thêm nhiều cột): trường hồ sơ còn đổi; kiểm dạng ở zod
  (`TenantProfileSchema`), DB chỉ chặn kiểu object + 8 KB. Danh sách tenant không trả `profile` (chỉ chi tiết).
- D-NO-02: Cây phòng ban: `departments.parent_group_id` + `sort_order` (M1 phẳng). Chỉ thông tin — luật thấy M1D-FR-03 không đổi
  (trưởng phòng chỉ thấy thành viên trực tiếp). Không vòng: file khai báo bắt cha khai TRƯỚC con; DB chặn tự trỏ. Chưa hiện cây trên
  contracts-web (contract `OrgResponse` giữ nguyên).
- D-NO-03: Tên tenant = tên pháp lý đầy đủ (≤ 128); nhãn tiếng Anh vào `groups.name.en`. "Bộ phận / Phòng ban trong công ty" bỏ.
  Khoá Group `pb-*` (tránh trùng `contracts-*`, `beta-testers`).
- D-NO-04: Gói bật bằng `enablePack` (cùng đường admin-web PK-FR-05) — trợ lý `mgmt-assistant` được grant cùng tx.
- D-NO-05: `--into-tenant` nhập đúng MỘT org (org đã gắn); không gộp nhiều org vào một tenant (danh mục/khách/công ty theo org sẽ
  đụng khoá tự nhiên). User không thuộc org nào vẫn đi N5 như I1 (NO_ORG). Tenant chưa gắn: dry-run chạy rỗng + báo `source_orgs`;
  apply lỗi `TENANT_NOT_BOUND`.
- D-NO-06: Marker không đổi lặng lẽ: đã gắn org khác ⇒ `ORG_REBIND`; org đã thuộc tenant khác ⇒ `ORG_TAKEN`.
- D-NO-07: Gán thành viên/trưởng phòng chỉ cộng (không xoá thành viên ngoài file — không đè chỉnh tay trên UI).
- D-NO-08: Không có e2e cho thẻ hồ sơ trong lát (chỉ đọc, dữ liệu do CLI ghi): unit `profileLines` + int API — e2e ghi ở Còn lại.

## Kết quả
- Int evotest (`run-tests.ps1 -Step int`, 0d8ada08): 347 pass / 0 fail, 34,7 s — NITI 7/7 + I1, N5, M1, M1D, M2/M3 db-schema,
  ADM-NFR-06 migrate, N1 admin-packs/pack-assistant, N2 admin-tenant.
- evotest-mgmt `run.ps1 -Tenant nitigroup` (bản sao seed, 2 org cùng tên "Công ty An Nam"): onboarding 1 tạo tenant + 23 phòng +
  contracts (3 Group vai); onboarding 2: 0 đổi. Importer `--into-tenant nitigroup` (org của chủ seed): dry 2.632 ms · apply 894 ms ·
  chạy lại 927 ms; 521 hàng / 22 bảng, chạy lại 0; org kia + 1 user bị loại (không tạo tenant); tiền 8 khoá khớp tuyệt đối (HĐ
  3.558.150.000 ₫, đợt 1.237.250.000 ₫, sổ 485.250.000 ₫, lô CKS 56.500.000 ₫…); file 1/1 sha; văn bản ký 71/71; so trường 48, lệch
  0; luật thấy 4/4; vấn đề {}. Tổng lượt 129 s.

## Còn lại
- e2e Playwright thẻ "Hồ sơ công ty" (Luật 4b) — cần seed `profile` cho tenant e2e.
- Hiện cây phòng ban (cha/thứ tự) ở contracts-web Cài đặt › Phòng ban (cần thêm trường vào `OrgResponse`).
- sohoptac thật có > 1 org ⇒ cần quyết định gộp (D-NO-05).
- FileBox sink cho CLI importer (I1 "Còn lại") vẫn mở — production phải có trước bước 7.

- D-NITI-09 (người dùng 2026-10-20): sohoptac cũ chỉ có 3 org dữ liệu thử/demo (.test) ⇒ KHÔNG nhập; NitiGroup trên sohoptac2 bắt đầu trống. Đã xoá niti-b-run.sh + niti-out/ trên máy chủ.

- D-DEMO-01 (người dùng 2026-10-20): tenant `demo` ("Demo Sổ Hợp Tác") vĩnh viễn trên sohoptac2 — `deploy/tenants/demo.yaml` (gốc + 3 phòng, gói contracts, gắn org sohoptac "Demo dữ liệu mẫu" 03daf8fa…). `mgmt-import --into-tenant demo` KHÔNG file: dry-run → pg_dump (`~/workspace/sohoptac2/backups/*.dump`) → apply 1.165 hàng (tiền khớp, ký 74/74) → chạy lại 0 hàng; vấn đề duy nhất `FILE_MISSING` ×19 (chủ ý, FileBox chưa nối). Đăng nhập demo-owner (tenant_admin + contracts-owner) / demo-editor / demo-viewer, email `@example.invalid`; mật khẩu chỉ ở `DEMO_CREDENTIALS.txt` (600) trên máy chủ. Notify: server `HUB_NOTIFY_MODE=live` + SMTP thật, không có công tắc theo tenant và không lọc tên miền ⇒ đã đặt `hub.notify_prefs` email=false/push=false cho mọi user tenant demo (user tạo thêm sau phải đặt lại). `mailtest`: không có API/đường xoá tenant ⇒ giữ nguyên, đang khoá. UAT AI thật: xem `docs/uat/cr095/report.md` "AI thật (sohoptac2)" (tải DOCX/Đọc lại chặn bởi FileBox).
