---
id: auth-refresh-reload
lát: auth-refresh-reload
cr:
làn: đầy đủ (auth) — một agent Sonnet làm, Opus low soát diff
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lỗi (bắt bởi e2e hành trình duyệt): F5 khi `POST /auth/refresh` lúc khởi động SPA còn dở ⇒ máy chủ đã xoay token nhưng phản hồi mang Set-Cookie bị huỷ
⇒ lần refresh kế trình token cũ ⇒ trước đây 401 `REFRESH_SUPERSEDED` (≤ 10 s, client thử lại bằng đúng cookie cũ nên vẫn lỗi) rồi > 10 s là reuse ⇒ thu hồi
cả chuỗi ⇒ bị đăng xuất. Sửa: ân hạn 30 s + **một lá sống mỗi chuỗi**. Token vừa xoay (`rotated`, ≤ 30 s) bị trình lại ⇒ khoá hàng token cũ FOR UPDATE,
nếu kế nhiệm (`replaced_by`) CHƯA dùng (còn sống) ⇒ thu hồi nó + cấp đúng một token thay thế (200 + Set-Cookie) + trỏ `replaced_by` sang token mới.
Kế nhiệm đã dùng/thu hồi ⇒ coi là reuse ⇒ thu hồi cả chuỗi. Quá ân hạn / lý do thu hồi khác ⇒ reuse như cũ. Review bảo mật (Opus): cấp lại không giới hạn
cho phép kẻ trộm phát lại trong 30 s có chuỗi sống song song không bao giờ trip reuse ⇒ thiết kế một-lá-sống thay "cấp token anh em".

## Làm
- `auth.rules.ts`: `REFRESH_GRACE_MS` 10 s → 30 s.
- `auth.repo.ts`: `swapUnusedSuccessor` (SELECT … FOR UPDATE hàng token cũ, rồi MỘT câu SQL CTE: thu hồi kế nhiệm còn sống + `replaced_by` token cũ → token mới).
- `auth.refresh.ts`: bỏ ném `REFRESH_SUPERSEDED`; `rotate(..., regrant)`: đường cấp lại (và lượt thua race song song) gọi `swapUnusedSuccessor`; "reuse" ⇒ thu hồi cả chuỗi ở giao dịch riêng.
  Lượt song song tuần tự hoá ở khoá hàng token cũ, mỗi lượt thay lá chưa dùng của lượt trước ⇒ N×200, cuối cùng đúng 1 lá sống (lá bị thay: 401 ở lần dùng sau ân hạn).
- Thứ tự khoá chung (chống deadlock): hàng user (FOR SHARE) → hàng token theo chiều chuỗi (cũ → mới). `revokeFamily` (logout, reuse) nay lấy `lockUserShared` trước.
- Logout thu hồi **cả chuỗi**, vẫn idempotent.

## Không làm / Chạm
Chạm: `apps/admin-api/src/modules/auth/{auth.refresh,auth.repo,auth.rules}.ts`. Không đổi schema/migration, không đổi client web (nhánh thử lại `REFRESH_SUPERSEDED` ở
web-kit/admin-web/studio-web vô hại, mã giữ trong contract cho client cũ). Hub-api không có refresh riêng (JWT do admin-api phát) ⇒ không chạm.

## Test tối thiểu
- unit/rules (acceptance M1): ân hạn 30 s (biên 30000/30001 ms).
- int `auth.service.int.test.ts` (đồng hồ giả = lùi `revoked_at`, không sleep): dùng lại ≤ 30 s ⇒ 200 và 1 lá sống; > 30 s ⇒ 401 + thu hồi chuỗi; kẻ trộm phát lại ⇒ lá của chủ bị thay,
  chủ dùng lá cũ sau ân hạn ⇒ reuse; chủ đã dùng lá kế nhiệm rồi phát lại ⇒ reuse; 4 lượt song song ⇒ 4×200 + đúng 1 lá sống; cô lập tenant.
- int acceptance M1 `auth-refresh.int.test.ts` (HTTP): cùng các ca + logout rồi dùng token cũ ⇒ 401; 5 song song ⇒ 5×200, đúng 1 lá sống.
- e2e `e2e/journey-approval/refresh-reload.ja.ts` (stack thật): phản hồi refresh bị huỷ rồi tải lại ⇒ vẫn đăng nhập; tải lại liên tiếp ⇒ vẫn đăng nhập.

## Quyết định trong lúc làm
- Không trả lại "cùng token kế nhiệm": DB chỉ lưu hash ⇒ cấp token mới (thay lá chưa dùng).
- Lượt có token bị thay (lượt thua race song song, hoặc chủ khi kẻ trộm phát lại) nhận 401 ở lần dùng sau ân hạn — chấp nhận (người dùng/review chốt); đổi lại phát hiện được trộm.
- `REFRESH_SUPERSEDED` không còn được phát; bỏ khỏi danh sách mã M1 phải có kịch bản (`error-codes.int.test.ts`, 22 → 21), mã giữ trong contract.
- Perf (đường nóng): số câu SQL đường vui (token hợp lệ) **không đổi** (4). Đường cấp lại: lock user, find user, SELECT FOR UPDATE, CTE UPDATE, insert = 5 (+1); lượt thua race: +2
  (trước: ném lỗi). Logout/reuse: +1 (`lockUserShared`), không thuộc đường vui. Không vòng lặp theo hàng, không sleep/poll.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED admin/tenant-user.md
#### Yêu cầu: Refresh token xoay vòng có ân hạn 30 s (không đăng xuất khi tải lại trang)
Dùng lại refresh token vừa xoay trong ≤ 30 s (phản hồi mang cookie mới bị mất khi tải lại trang, hoặc hai tab refresh song song) được cấp một token thay thế (200); chuỗi luôn chỉ có MỘT token sống: lá kế nhiệm chưa dùng bị thu hồi và thay bằng lá mới. Nếu lá kế nhiệm đã được dùng, hoặc quá 30 s, hoặc token bị thu hồi vì lý do khác ⇒ 401 và thu hồi cả chuỗi (phát hiện đánh cắp). Chuỗi đã đăng xuất/khoá thì không được cấp lại. Đăng xuất thu hồi cả chuỗi.
- Kịch bản: khi dùng lại token đã xoay trong 30 s thì 200 và chỉ còn một token sống [test: apps/admin-api/src/modules/auth/auth.service.int.test.ts » ADM-FR-02 · xoay: dùng lại token cũ ≤ 30 s → 200 và chỉ còn MỘT lá sống, lá chưa dùng bị thay, sau đó lá mới vẫn xoay được]
- Kịch bản: khi dùng lại token đã xoay quá 30 s thì 401 và thu hồi cả chuỗi [test: tests/acceptance/M1/auth-refresh.int.test.ts » ADM-FR-02 · M1-AC04 · reuse (> 30 s) → 401 INVALID_REFRESH_TOKEN, thu hồi cả chuỗi, token mới cũng chết, cookie bị xoá]
- Kịch bản: khi kẻ trộm phát lại token cũ trong 30 s thì lá của chủ bị thu hồi và chủ dùng lá cũ sau ân hạn làm thu hồi cả chuỗi [test: tests/acceptance/M1/auth-refresh.int.test.ts » ADM-FR-02 · M1-R07 · kẻ trộm phát lại token cũ ≤ 30 s → lá của chủ bị thu hồi, chỉ một lá sống, chủ dùng lá cũ sau 30 s → thu hồi cả chuỗi]
- Kịch bản: khi chủ đã dùng lá kế nhiệm rồi bản sao token cũ phát lại thì thu hồi cả chuỗi [test: tests/acceptance/M1/auth-refresh.int.test.ts » ADM-FR-02 · M1-R07 · chủ đã dùng lá kế nhiệm rồi bản sao token cũ phát lại ≤ 30 s → 401, thu hồi cả chuỗi, lá của chủ cũng chết]
- Kịch bản: khi nhiều refresh song song cùng cookie thì tất cả thành công và chỉ còn đúng một token sống [test: tests/acceptance/M1/auth-refresh.int.test.ts » ADM-FR-02 · M1-R07 · 5 refresh song song cùng cookie → cả 5×200 và cuối cùng đúng MỘT lá sống, không ai bị thu hồi chuỗi]
- Kịch bản: khi đã đăng xuất thì token cũ trong ân hạn không được cấp lại [test: tests/acceptance/M1/auth-refresh.int.test.ts » ADM-FR-02 · M1-R07 · đã đăng xuất thì token cũ trong ân hạn KHÔNG được cấp lại (không sống lại phiên)]
- Kịch bản: khi reuse ở tenant A thì chuỗi tenant B không bị đụng và token B chỉ cấp phiên B [test: apps/admin-api/src/modules/auth/auth.service.int.test.ts » ADM-FR-02 · cô lập tenant: reuse ở tenant A không đụng chuỗi tenant B, token B trong ân hạn chỉ cấp phiên B, B bị khoá → 401]
- Kịch bản: khi tải lại trang lúc phản hồi refresh bị huỷ thì lần tải sau vẫn đăng nhập [test: e2e/journey-approval/refresh-reload.ja.ts » 1 · phản hồi refresh bị huỷ lúc tải lại ⇒ lần tải sau vẫn đăng nhập (token cũ được cấp lại trong ân hạn)]

## Việc còn lại
- Điều phối: gỡ workaround "chờ trang nạp xong trước khi tải lại" ở `e2e/journey-approval/_journey.ts` `approveAs` (vẫn còn).