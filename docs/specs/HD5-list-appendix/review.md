# Review HD5 (danh sach/phu luc/danh ba) - platform/gd0

Pham vi: 1f1d4b90, b52d9a66, 07cb11c7, 683e9191. Doc code, khong chay test (may qua tai).

**Verdict: CHANGES_REQUESTED** - Cao 1 · Trung 3 · Thap 2.

## Phat hien

| # | Muc | Noi dung |
|---|---|---|
| 1 | **Cao** | 683e9191 sua test khoa HD1 `tests/acceptance/HD1/list.int.test.ts` (`b: { items: [], total: 0, parents: [], page: 1, page_size: 20 }`). Day KHONG phai sua setup/kieu: no doi dieu test khang dinh (hinh dang `ListResponse` HD1) do HD5 them `parents` vao strictObject. Thay doi hop ly ve noi dung nhung (a) `tests/**` thuoc qc, commit lai do dev/lead lam, (b) khong co ban ghi Tranh chap test (tasks.md/test-plan khong nhac), (c) message "qc can relock" cho thay chua relock (`tests/.lock`). Can: ghi Tranh chap test + qc phan xu, relock. Doi `list-contracts.usecase.test.ts` (unit, 1f1d4b90) la test cua chinh code HD5, chap nhan duoc. |
| 2 | Trung | Race tao vong/phu luc-cua-phu-luc: `lockForParent` chi `FOR UPDATE` hang con; `parent_kind` doc khong khoa. A->B va B->A dong thoi: moi ben thay ben kia la `contract`, `hasAppendices=false` => ca hai thanh phu luc cua nhau (hoac cha vua thanh phu luc o giao dich khac). Khong co rang buoc DB. Sua: khoa cha `FOR SHARE`/`UPDATE` theo thu tu id (hoac check constraint/trigger) + test dong thoi. Test hien chi phu tuan tu. |
| 3 | Trung | `GET /contracts/:id/prices` dung `new Date().toISOString().slice(0,10)` (UTC) lam `as_of` => `current` sai 1 ngay trong 00:00-07:00 gio VN (dong bat dau hom nay chua hieu luc, dong het han hom qua con "current"). Chi hien thi (khong ghi `valid_to`/`total_value`) nen khong rui ro tien, nhung la loi dung dan: HD4 da chot "ngay lich o mui tenant" (spec HD4-FR-02) va HD7/HD8 se dung chung ham. tasks.md tu ghi la "mo" - nen dong hoac tao muc no co han. Sua: truyen `TenantState.timezone` vao `today()`; test tiem `today` da co san. |
| 4 | Trung | Layout shell: `layoutOf` dua `/partners`, `/prices`, `/cks` vao "board" (max 1600, tu cuon doc), truoc day moi man 900/1100. e2e HD5 chi co 3 canh S03 chay lai ("3 canh S03 chu 0 lech"); khong thay bang chung chay lai shell/s05/s08/s10/s11 sau khi doi (baseline s08/s10/s11 chup 21:50-21:51 la cua HD9, khong ro truoc/sau doi Shell). Phai chay lai `e2e:contracts` day du truoc merge (nhu da noi, khong chay o day). `/partners` chua co canh. |
| 5 | Thap | HD1 "19 khoa ListRow" do: **thuoc HD4, khong phai HD5.** Test HD1 (tao o 78bdab14) da liet ke `action_deadline` trong 19 khoa va khang dinh `action_deadline: null`; HD5 khong dong vao `ContractListRow`/mapper cot nay. Trigger `hd4_schedule` cua HD4 (95890814) tinh `end_date - notice_days` => HD-001 (end 2027-03-31, notice 30) khong con null. HD4 phai cap nhat gia tri/Tranh chap test cua no; HD5 khong duoc "doi" no. Cung ap dung cho 3 test HD4/HD9 dang sua do trong working tree (`git status`): khong thuoc HD5. |
| 6 | Thap | Goi y/gia doc `qty numeric(18,4)`, `vat_rate numeric(5,2)` qua `json_build_object` thanh JS number; chi hien thi, khong co phep tinh tien. `unit_price` bigint -> number < 2^53. Chap nhan. |

## Da kiem, dat

- **Gia phu luc doc-only**: `applyAppendixPricing` thuan (khong DB); `family` la 1 SELECT; khong UPDATE `valid_to`/`total_value` o dau trong HD5. `valid_to` chi tinh tren ban sao trong bo nho. Loc trang thai `PRICED_STATUSES = active/expiring/expired/renewed/terminated` (khong tinh dang doc/loi/cho kiem/tu choi) dung; `kind='contract'` luon vao. Tien: `unit_price` bigint, khong float. Gioi han 101 HD x 500 dong.
- **Tenant**: moi cau SQL loc `tenant_id` ngoai RLS (`contracts_rw` FORCE); cha khac tenant => `parent_kind` null => `not_a_contract` (422, khong lo ton tai); id la/tenant khac => 404 nhu nhau; `:id` sai dang 400. Guard `write` cho PATCH parent va POST categories (viewer 403, 0 SQL); `read` cho members/categories/suggestions/prices. Members: tenant tu token, chi `{id,name}`, loc active va khong bi khoa. Categories: unique `lower(name)` + tran 200 trong 1 cau. Version lock lac quan + event `parent_changed` + outbox.
- **Perf**: danh sach them `parents` trong CUNG cau (2 cau SQL), tra PK; test perf dat 50 ms nhu HD1, khang dinh dem SQL (2; goi y 3) va EXPLAIN khong Seq Scan tren contracts/contract_items cho moi duong HD5; so bao cao 23,2 ms ~ HD1 (23,9-26,6). Dat.
- Dong bo 4 dong i18n/FE: khong thay van de ve cach ly.

## Yeu cau truoc khi APPROVED
1. (Cao) Ghi Tranh chap test cho sua HD1 list + qc relock.
2. (Trung) Khoa cha khi gan phu luc (hoac rang buoc DB) + test dong thoi.
3. (Trung) `as_of` theo mui tenant.
4. (Trung) Chay lai e2e:contracts day du (shell/S05/S08/S10/S11).