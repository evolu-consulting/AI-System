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
cả chuỗi ⇒ bị đăng xuất. Sửa: ân hạn 30 s; token vừa xoay (`revoked_reason = rotated`, ≤ 30 s) được **cấp lại** một token mới cùng chuỗi (200 + Set-Cookie),
không thu hồi chuỗi. Quá ân hạn / lý do thu hồi khác ⇒ reuse như cũ (thu hồi chuỗi).

## Làm
- `auth.rules.ts`: `REFRESH_GRACE_MS` 10 s → 30 s.
- `auth.refresh.ts`: bỏ ném `REFRESH_SUPERSEDED`; `rotate(..., regrant)`: bỏ UPDATE xoay, thay bằng `familyAlive` (SELECT … FOR SHARE) rồi `issueSession` cùng chuỗi/hạn.
  Lượt thua race song song (UPDATE xoay 0 hàng) cũng đi đường cấp lại ⇒ song song N lượt ⇒ N×200. Cấp lại cần chuỗi còn ≥ 1 token sống (đã logout / reuse /
  khoá user / đổi mật khẩu ⇒ 401, không sống lại phiên) và chuỗi chưa quá hạn tuyệt đối.
- `auth.repo.ts`: `familyAlive`. Logout thu hồi **cả chuỗi** (token cấp lại trong ân hạn cũng chết), vẫn idempotent.
- Không thu hồi token "anh em": cookie nào trình duyệt giữ (lượt thắng hay lượt cấp lại, phản hồi nào đến sau) đều dùng được.

## Không làm / Chạm
Chạm: `apps/admin-api/src/modules/auth/{auth.refresh,auth.repo,auth.rules}.ts`. Không đổi schema/migration, không đổi client web (nhánh thử lại `REFRESH_SUPERSEDED` ở
web-kit/admin-web/studio-web vô hại, mã giữ trong contract cho client cũ). Hub-api không có refresh riêng (JWT do admin-api phát) ⇒ không chạm.

## Test tối thiểu
- unit/rules (acceptance M1): ân hạn 30 s (biên 30000/30001 ms).
- int `auth.service.int.test.ts` (đồng hồ giả = lùi `revoked_at`, không sleep): dùng lại ≤ 30 s ⇒ 200 phiên sống; > 30 s ⇒ 401 + thu hồi chuỗi; 4 lượt song song ⇒ cả 4 thành công;
  cô lập tenant (reuse A không đụng B; B khoá ⇒ 401).
- int acceptance M1 `auth-refresh.int.test.ts` (HTTP): cùng các ca + logout rồi dùng token cũ ⇒ 401; 5 song song ⇒ 5×200.
- e2e `e2e/journey-approval/refresh-reload.ja.ts` (stack thật): phản hồi refresh bị huỷ rồi tải lại ⇒ vẫn đăng nhập; tải lại liên tiếp ⇒ vẫn đăng nhập.

## Quyết định trong lúc làm
- Không trả lại "cùng token kế nhiệm": DB chỉ lưu hash ⇒ cấp token mới cùng chuỗi (đã chọn theo yêu cầu "fresh pair").
- Không thu hồi token kế nhiệm của lượt thắng khi cấp lại: nếu cookie của lượt thắng là cái đến sau thì refresh kế (> 30 s sau) sẽ bị coi là reuse ⇒ đăng xuất oan.
- `REFRESH_SUPERSEDED` không còn được phát; bỏ khỏi danh sách mã M1 phải có kịch bản (`error-codes.int.test.ts`, 22 → 21), mã giữ trong contract.
- Perf (đường nóng): số câu SQL đường vui (token hợp lệ) **không đổi**. Đường cấp lại: bỏ 1 UPDATE (xoay) thêm 1 SELECT FOR SHARE ⇒ cùng số câu so với một lượt xoay;
  lượt thua race: +1 SELECT (trước đó ném lỗi). Không sleep/poll.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED admin/tenant-user.md
#### Yêu cầu: Refresh token xoay vòng có ân hạn 30 s (không đăng xuất khi tải lại trang)
Dùng lại refresh token vừa xoay trong ≤ 30 s (phản hồi mang cookie mới bị mất khi tải lại trang, hoặc hai tab refresh song song) được cấp một token mới cùng chuỗi (200), không thu hồi chuỗi; quá 30 s hoặc token bị thu hồi vì lý do khác ⇒ 401 và thu hồi cả chuỗi (phát hiện đánh cắp). Chuỗi đã đăng xuất/khoá thì không được cấp lại. Đăng xuất thu hồi cả chuỗi.
- Kịch bản: khi dùng lại token đã xoay trong 30 s thì 200 cùng chuỗi và phiên còn sống [test: apps/admin-api/src/modules/auth/auth.service.int.test.ts » ADM-FR-02 · xoay: cũ rotated, dùng lại ≤ 30 s → 200 cấp lại cùng chuỗi, phiên sống, lùi 31 s → reuse cả chuỗi]
- Kịch bản: khi dùng lại token đã xoay quá 30 s thì 401 và thu hồi cả chuỗi [test: tests/acceptance/M1/auth-refresh.int.test.ts » ADM-FR-02 · M1-AC04 · reuse (> 30 s) → 401 INVALID_REFRESH_TOKEN, thu hồi cả chuỗi, token mới cũng chết, cookie bị xoá]
- Kịch bản: khi nhiều refresh song song cùng cookie thì tất cả thành công, không ai bị đăng xuất [test: tests/acceptance/M1/auth-refresh.int.test.ts » ADM-FR-02 · M1-R07 · 5 refresh song song cùng cookie → cả 5×200, mỗi lượt một cookie riêng còn dùng được, chuỗi không bị thu hồi]
- Kịch bản: khi đã đăng xuất thì token cũ trong ân hạn không được cấp lại [test: tests/acceptance/M1/auth-refresh.int.test.ts » ADM-FR-02 · M1-R07 · đã đăng xuất thì token cũ trong ân hạn KHÔNG được cấp lại (không sống lại phiên)]
- Kịch bản: khi reuse ở tenant A thì chuỗi tenant B không bị đụng và token B chỉ cấp phiên B [test: apps/admin-api/src/modules/auth/auth.service.int.test.ts » ADM-FR-02 · cô lập tenant: reuse ở tenant A không đụng chuỗi tenant B, token B trong ân hạn chỉ cấp phiên B, B bị khoá → 401]
- Kịch bản: khi tải lại trang lúc phản hồi refresh bị huỷ thì lần tải sau vẫn đăng nhập [test: e2e/journey-approval/refresh-reload.ja.ts » 1 · phản hồi refresh bị huỷ lúc tải lại ⇒ lần tải sau vẫn đăng nhập (token cũ được cấp lại trong ân hạn)]

## Việc còn lại
- Chạy int + e2e trên evotest (xem báo cáo). Điều phối: gỡ workaround "chờ trang nạp xong trước khi tải lại" ở `e2e/journey-approval/_journey.ts` `approveAs` khi e2e xanh.
