# Review · N3-notify (thông báo dùng chung: in-app + email + push web)

- Phạm vi: `126e6b08` (migration hub 0040 + kit 0004, `modules/notify`, Notifier gói, secret kinds, test cách ly/dispatch) + `42536033` (chuông S16, prefs, e2e, perf, `tests/.lock`). Spec/plan/tasks `docs/specs/N3-notify/`. ADR-0027 (Proposed) không đánh giá lựa chọn thư viện.
- Reviewer: một vòng, chỉ đọc. Ngày 2026-10-19.
- Viết tắt: `nt/` = `apps/hub-api/src/modules/notify/`, `0040` = `packages/db/migrations-hub/0040_n3_notify.sql`, `0004` = `packages/db/migrations-packs/0004_n3_notify.sql`.

## Kết luận: **CHANGES_REQUESTED**

1 Cao · 4 Trung · 9 Thấp. Phần cách ly tenant (enqueue, RLS, role gói) đạt. Chặn vì C1: một test đã khoá của H4b1 đang đỏ do đổi contract, và không có ghi chú "Tranh chấp test".

## Đã kiểm, đạt

| Điểm | Kết quả |
|---|---|
| (a) `notify.enqueue` DEFINER | `0040:142-169`: `SET search_path = pg_catalog, pg_temp`, tên bảng đủ schema. Tenant chỉ lấy từ `app.tenant_id` (`0040:145`), vắng thì 22023 (test `isolation.int.test.ts:49-56`). Đầu vào jsonb không có cột tenant: `jsonb_to_recordset` bỏ qua khoá lạ. Người nhận ngoài tenant hoặc không tồn tại bị lọc lặng lẽ (`0040:162`, test `:109-122`). Lô > 500, không phải mảng, hoặc source sai dạng thì 22023. `REVOKE … FROM PUBLIC` cho cả schema lẫn hàm, test `has_function_privilege('public')=false`. |
| Role gói | `0004:3-12`: `<k>_rw` chỉ có USAGE `notify` + EXECUTE hàm. Test `isolation.int.test.ts:124-151`: không USAGE `hub`/`admin` (PK-AC03 giữ nguyên), SELECT/INSERT thẳng thì 42501, mọi gói đã cài đều được backfill (`0004:63-71`). `notify` đã thêm vào `packs.check_key` (`0004:74-81`) và `RESERVED_PACK_KEYS` (`packages/contracts/src/packs.ts`). |
| (b) RLS | `0040:94-117`: `notifications`/`notify_prefs`/`push_subscriptions` cho system thấy hết, user chỉ thấy hàng có tenant **và** user trùng GUC. `notification_deliveries` chỉ system. Không đặt scope thì 0 hàng. Grant: `notifications` không có INSERT (chỉ qua hàm), UPDATE theo cột (`read_at`, `fanout_at`). Test giả mạo cặp tenant/user (`:204-211`), sửa `title` thì 42501 (`:234-248`), ghi prefs cho người khác thì 42501. Route lấy tenant/user từ token, có thêm lọc tường minh ngoài RLS (`nt/adapters/inbox.repo.ts:17-85`). |
| (c) Worker | Fan-out và claim đều dùng `FOR UPDATE SKIP LOCKED` (`nt/adapters/dispatch.repo.ts:45-91`). Lease 120 s được lưu vào `next_attempt_at` của hàng `sending`. Gửi diễn ra ngoài tx, mỗi kênh một lời gọi transport (`nt/application/dispatch.usecase.ts:55-117`). Backoff 60/300/1800/7200, lần 5 thì dead, lỗi vĩnh viễn thì dead ngay (`nt/domain/notify.rules.ts:5-40`). Push 410 thì xoá đăng ký (`dispatch.repo.ts:113-115`). Mã lỗi đi qua `safeCode`, không chứa nội dung (test `dispatch.int.test.ts:157-176`). Hai worker song song trên 60 bản gửi cho đúng 60 thư (`:209-231`). Kiểu bản gửi theo tenant: test lô trộn tenant (`:96-118`). |
| (d) Secret | Kind `smtp_password`/`vapid_private_key` buộc `tenant_id IS NULL` cả ở CHECK (`0040:186-193`) lẫn `secretScopeOk`. `canManageSecret` chỉ cho route studio/platform_admin. Giá trị chỉ sống trong callback `HubSecretReader` (`nt/adapters/credentials.ts`), test log không chứa giá trị, `hub_rw` không SELECT được ciphertext (`secrets.int.test.ts`). |
| (e) `HUB_NOTIFY_MODE=live` | `apps/hub-api/src/config/env-deps.ts:37-39` ném lỗi lúc boot. `transportsFor("live")` cũng ném `NotifyNotConfigured`. Test `nt/adapters/transports.test.ts:17-37`. |
| (f) Thứ tự migration | Journal hub: `0037` (1794268800000) < `0040_n3` (1794700000000) < `0041_n2` (1794800000000). Kit `0004` (1794700000000) > `0003`. Runner kit chạy sau hub (`packages/db/src/migrate-packs.ts:3`), nên schema `notify` đã có khi `0004` chạy. |
| (g) `tests/.lock` | So theo tập (bỏ qua thứ tự): `42536033` chỉ thêm đúng 7 hàng N3 (`tests/acceptance/N3/**` ×6 + `e2e/contracts-web/bell.cw.ts`), không bớt hàng nào. Hash khớp nội dung HEAD (đã kiểm 3 file). |
| Perf (Luật 4c) | Mỗi pha 1 câu, jsonb một tham số, đếm câu bằng test (3 câu/lô, khi rảnh 2 câu). |

## Chạy lại test (reviewer)

- Unit `bun test apps/hub-api/src/modules/notify`: 12 pass.
- Int `bun run test:int:par tests/acceptance/N3/{isolation,dispatch,api,secrets}.int.test.ts`: 42 pass, 7.2 s.
- Perf `PERF=1 … bunfig.perf.toml test tests/acceptance/N3/perf/dispatch.perf.int.test.ts`: 1 pass. p95: ghi cổng 8.50 ms · chia kênh 13.83 ms · nhận 7.17 ms · ghi kết cục 4.80 ms (max 74 ms ở chia kênh). 300 câu/100 lô. 10.000 tin gửi xong trong 1.88 s.
- `bun test tests/acceptance/H4b1/rules/contracts-h4b1.test.ts`: **11 pass, 1 fail** (xem C1).

## Phát hiện

### Cao

**C1. Đổi contract `HUB_SECRET_KINDS` làm đỏ test đã khoá của H4b1 mà không ghi tranh chấp.**
`packages/contracts/src/hub-admin/secrets.ts:8-15` thêm `smtp_password` và `vapid_private_key`. Hai test khoá dưới đây vẫn khẳng định đúng 3 kind:
- `tests/acceptance/H4b1/rules/contracts-h4b1.test.ts:28-34` (R50, `toEqual` 3 phần tử): **đỏ**, đã chạy lại xác nhận.
- `tests/acceptance/H4b1/_h4b1.ts:59` và `rules/secrets-rules.test.ts:9` (danh sách KINDS cũ, không đỏ nhưng không còn phủ kind mới).

Hệ quả: `bun test` thuộc Lệnh xong đỏ. Việc này vi phạm Luật 3 (agent code không sửa test khoá; nếu tin test sai thì phải ghi "Tranh chấp test"), trong khi `tasks.md` ghi "Tranh chấp test: (không)" và T8 đã tick cổng. Đây cũng là đổi contract của lát đã duyệt (H4b1 spec §3, `HUB_SECRET_KINDS` = 3 giá trị), tức hard stop theo Luật 2 cần ghi rõ.
Sửa: ghi "Tranh chấp test" trong `tasks.md` N3 + một dòng CR/quyết định trong spec H4b1, rồi để qc cập nhật R50 (5 kind) và `_h4b1.ts` KINDS và relock. Cách khác: tách kind thông báo khỏi `HUB_SECRET_KINDS` dùng cho UI Studio (xem M3).

### Trung

**M1. `settle` không có fencing token, nên worker có lease đã hết hạn vẫn ghi đè kết cục của lượt claim mới.**
`nt/adapters/dispatch.repo.ts:107-112` chỉ lọc `d.id = r.id and d.status = 'sending'`. Kịch bản: A claim (attempts=1), gửi lâu hơn 120 s. B claim lại (attempts=2) và gửi. A settle `retry` thì hàng về `pending`, lượt `sent` của B sau đó bị bỏ qua (`status ≠ 'sending'`), và tin bị gửi thêm lần nữa. Ngược lại, A settle `sent` trong khi B còn đang gửi. Không có timeout transport nhỏ hơn lease (`nt/application/dispatch.usecase.ts:62-65`, `safeBatch` không có hạn), nên SMTP treo kéo dài lô quá lease là điều có thể xảy ra.
Sửa: đưa `attempts` (đã trả từ claim) vào batch settle và thêm `and d.attempts = r.attempts`. Đặt hạn cho mỗi lời gọi transport (AbortSignal) < `LEASE_SEC`. Cần thêm test int: claim, quá hạn, claim lại, rồi settle cũ không đổi hàng.

**M2. Claim lại sau khi lease hết hạn không chặn `MAX_ATTEMPTS`, và CHECK `attempts ≤ 20` có thể làm kẹt cả hàng đợi.**
`dispatch.repo.ts:72-80` nhận mọi hàng `pending|sending` tới hạn và `attempts + 1`, không xét trần. Bản gửi đã có 5 lần thử mà worker chết trước khi settle sẽ được gửi lần 6, 7…, trái với spec FR-06 ("quá 5 lần ⇒ dead"). Một tin độc làm worker crash lặp lại sẽ đẩy `attempts` tới 21. Khi đó CHECK `0040:51` làm **cả câu claim** lỗi, mọi lô sau đều lỗi, và toàn bộ hàng đợi (mọi tenant) bị kẹt.
Sửa: trong `due` thêm `and d.attempts < 5`, và chuyển hàng `sending` hết hạn đã đủ 5 lần sang `dead` (`lease_expired`) trong cùng CTE. Thêm test.

**M3. Studio Secrets hiện 2 tab mới mà thiếu nhãn i18n.**
`apps/studio-web/src/features/secrets/pages/SecretsPage.tsx:138` map toàn bộ `HUB_SECRET_KINDS` thành tab `t(\`secrets.tab.${k}\`)`. `packages/i18n/locales/studio/{vi,en}.json` chỉ có khoá cho 3 kind cũ (dòng 646, 684: tab + trạng thái rỗng). Platform admin sẽ thấy khoá thô. Ảnh hoặc e2e Studio Secrets có thể lệch. Thay đổi này chạm UI lát H4b1 mà N3 không có e2e hay ghi chú nào (Luật 4b).
Sửa: thêm khoá i18n và e2e/ảnh Studio cho 2 tab, hoặc chủ động loại kind thông báo khỏi tab cho tới khi có adapter thật (ADR-0027).

**M4. Commit `126e6b08` không bisect được và chứa dòng của lát khác.**
`packages/db/migrations-hub/meta/_journal.json` ở `126e6b08` đã có entry `0041_n2_engine`, trong khi file SQL chỉ được thêm ở `42767d4f` (N2). Checkout `126e6b08` rồi chạy `db:migrate` sẽ lỗi vì thiếu file. HEAD đã ổn. Đây cùng loại lỗi "ghi đè phần của lát khác" mà `8213d6da` phải sửa cho lock.
Sửa: không cần viết lại lịch sử (không push lại), chỉ cần ghi chú trong `tasks.md` để người bisect biết. Lần sau chỉ commit hunk của lát mình (`git add -p`).

### Thấp

- **L1. Hàm cổng tin GUC mà role gói tự đặt được, và `p_source` không gắn với role gọi.** `0040:145,151`: code chạy dưới `<k>_rw` có thể `set_config('app.tenant_id', …)` hoặc truyền `p_source = 'hub'`/khoá gói khác. Mô hình tin cậy giống RLS bảng gói (code gói là first-party) nên không chặn. Dù vậy, nên bắt `p_source = left(current_setting('role'), -3)` khi role kết thúc `_rw` để nguồn và không gian dedup không giả được.
- **L2. `GRANT UPDATE (read_at, fanout_at)` cho `hub_rw` áp cả scope user** (`0040:128`). Đường code user chỉ sửa `read_at`, nhưng về quyền thì user scope đặt được `fanout_at` của chính mình, tức chặn email/push của mình. Vô hại về cách ly. Có thể tách bằng policy UPDATE riêng (`WITH CHECK fanout_at IS NOT DISTINCT FROM` giá trị cũ, qua trigger) nếu muốn chặt hơn.
- **L3. Đăng ký push upsert bằng scope system, nên endpoint chuyển được chéo tenant** (`nt/adapters/inbox.repo.ts:69-76`). Đây là quyết định đã ghi trong `tasks.md`, và cần biết endpoint (giá trị bí mật của trình duyệt) mới làm được. Hậu quả chỉ là chủ cũ mất push trên endpoint đó. Chấp nhận được, nên ghi trong spec §2.
- **L4. Kiểm `link` `^/[^/\\]` cho qua ký tự điều khiển** (`0040:25`, `packages/contracts/src/notify.ts:7`). Ví dụ `/\t/evil.example`: trình duyệt bỏ TAB/LF khi parse href, ra `//evil.example`. Mở bằng tab mới từ `<Link>` (`apps/contracts-web/src/features/shell/components/NotificationItems.tsx:38`) sẽ đi ra ngoài. Nguồn link là code gói, nhưng có thể chứa dữ liệu người dùng. Sửa: thêm điều kiện không có `[\x00-\x20\x7f]` ở cả CHECK lẫn zod.
- **L5. `HUB_NOTIFY_MODE=fake` được phép ở production** (`apps/hub-api/src/config/env.ts:93`, `nt/adapters/transports.ts:22`). Ở chế độ này mọi bản gửi được đánh `sent` mà không gửi thật. Nên fail boot khi `appEnv=production` (giống `pkdemo` devOnly).
- **L6. Comment "chừa chỗ cho lát N2/N5"** (`0040:3`) dễ gây hiểu nhầm. Drizzle bỏ qua migration có `when` ≤ `created_at` của migration áp cuối, nên một `0038/0039` thêm sau với `when` < 1794800000000 sẽ bị **bỏ qua lặng lẽ** trên DB đã áp `0041`. Nên ghi rõ "migration mới luôn có `when` lớn hơn max hiện tại".
- **L7. Claim không kiểm lại user còn active/không bị khoá** (`dispatch.repo.ts:89`, `left join admin.users`). User bị khoá sau fan-out vẫn nhận email ở các lần thử lại (tối đa khoảng 2,6 giờ: 1′ + 5′ + 30′ + 2h). Nên thêm `u.active and not u.locked_by_tenant` vào điều kiện gửi, nếu không thì permanent `user_inactive`.
- **L8. `tests/.lock` bị sắp xếp lại toàn file** (diff 207 dòng, nhưng so theo tập chỉ +7 hàng N3). Không sai, nhưng gây nhiễu cho review và merge của lát khác. Nên giữ thứ tự sinh của `test:lock:write`.
- **L9. Thiếu test và nợ.** Chưa có test cho: settle cũ sau lease (M1), trần attempts khi claim lại (M2), `prosecdef`/`proconfig` của `notify.enqueue`, đầu vào có khoá `tenant_id` lạ bị bỏ qua, link có ký tự điều khiển. Perf mới đo claim khi backlog `pending` ≤ 100, chưa đo backlog lớn (vd 10.000 bản gửi tới hạn). Chưa có dọn `notifications`/`notification_deliveries` cũ và không có FK tới user hay tenant: nên ghi vào `docs/TECH-DEBT.md`.

## Việc cần làm để APPROVED

1. C1: ghi tranh chấp + CR, để qc cập nhật test H4b1 (R50, KINDS) và relock. `bun test tests/acceptance/H4b1` phải xanh.
2. M1 + M2: fencing `attempts` trong settle, trần attempts và dead khi lease hết hạn ở claim, hạn transport < lease. Thêm test int cho cả hai.
3. M3: thêm i18n (và e2e Studio) cho 2 tab, hoặc ẩn 2 kind này khỏi UI.
