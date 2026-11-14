# fix-review-r1 — sửa theo soát Opus (CR-147 / CR-148 / CR-149)

## Plan
Sửa 8 điểm soát: XSS xem Word, lộ thẻ người cho đối tác, trần avatar, con trỏ danh bạ, `before` im lặng, `start_when` hỏng, audit ảnh bìa công ty, cache thẻ người. Mỗi lỗi có test đỏ trước (N8).

## Làm
| # | Việc | Trạng thái |
|---|---|---|
| 1 | Xem Word: iframe `sandbox=""` + gỡ link/`on*`/script + CSP (`docx-safe.ts`, `DocxFrame.tsx`) | xong (unit) |
| 2 | `GET /people?ids=`: đối tác chỉ thấy người cùng tổ chức đối tác, cờ lấy từ DB (`people.repo.ts`) | xong (int chờ chạy) |
| 3 | Avatar ≤ 150 KB: zod + CHECK hub 0144 (client vẫn cho chọn ảnh gốc ≤ 2 MB rồi cắt) | xong |
| 4 | Con trỏ danh bạ: trần 300 → 1024 (`MSG_PEOPLE_CURSOR_MAX`) | xong |
| 5 | `before` không có/không thấy ⇒ 400 `COMMENT_BEFORE_NOT_FOUND` | xong |
| 6 | `start_when` đọc bằng `FactWhenSchema`; hỏng ⇒ null + `start_when_unreadable` | xong |
| 7 | `PUT /brand/cover` ghi `company_settings.updated_by` = người đổi | xong |
| 8 | Cache thẻ người theo phiên + bộ đếm phiên bản (`person-card-store.ts`) | xong |

## Quyết định trong lúc làm
- (2) Đối tác (DB `kind='external'` hoặc token `external`) ⇒ chỉ thẻ người cùng `external_org_id` của mình, tính trong cùng MỘT câu (CTE `me`); người gọi không còn trong tenant ⇒ rỗng. `/people/me` giữ nguyên (chỉ hồ sơ của chính mình).
- (3) Trần 150 KB = 153 600 byte / 205 000 ký tự base64; migration 0144 gỡ avatar cũ vượt trần (chưa có khách, không backfill). Trần ảnh GỐC phía client tách riêng (`AVATAR_SOURCE_MAX_BYTES` = 2 MB) để người dùng vẫn chọn được ảnh lớn rồi bị cắt 256 px WebP.
- (4) Chọn nâng trần 1024 (không đổi khoá sắp xếp): con trỏ [cờ, tên phòng ≤ 64, tên ≤ 64, id] tối đa ≈ 600 ký tự với tiếng Việt 3 byte.
- (5) Mã lỗi mới `COMMENT_BEFORE_NOT_FOUND` (AppError 400, cùng khuôn `MENTION_NOT_ALLOWED`); cờ tính trong cùng câu SQL (không thêm câu).
- (7) «Cơ chế audit hiện có» của `company_settings` là cột `updated_by`/`updated_at`/`version`; `setCover` trước đây chạy tx hệ thống nên `updated_by` rỗng ⇒ truyền người đổi tường minh.
- (1) e2e `e2e/cr149/file-preview.spec.ts:92` đọc chữ Word từ `docx-viewer`; nay nội dung nằm trong iframe ⇒ QC cần đổi sang `frameLocator('[data-testid="docx-frame"]')`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tai-lieu-kem.md

#### Yêu cầu: Xem tệp Word không chạy được nội dung độc hại
Tệp .docx do người khác tải lên được dựng thành HTML trong khung `iframe sandbox` rỗng (không script, không cùng origin); liên kết chỉ giữ http(s), mailto, `#`.
- Kịch bản: khi tệp Word có liên kết javascript: thì liên kết bị gỡ, liên kết https giữ và mở tab mới an toàn [test: apps/workspace-web/src/components/shared/file-viewer/docx-safe.test.tsx » liên kết javascript: bị gỡ href]
- Kịch bản: khi mở tệp Word thì khung xem là iframe sandbox không allow-scripts và không allow-same-origin [test: apps/workspace-web/src/components/shared/file-viewer/docx-safe.test.tsx » iframe sandbox rỗng]

### MODIFIED community/nghiep-vu.md

#### Yêu cầu: Thẻ người theo lô không lộ nhân viên chủ quản cho đối tác
`GET /people?ids=`: nhân viên thấy mọi người cùng công ty; đối tác chỉ thấy người cùng tổ chức đối tác của mình (cờ đối tác lấy từ DB, không tin token); công ty khác không bao giờ lọt vào.
- Kịch bản: khi đối tác xin thẻ của nhân viên chủ quản thì không lộ tên, chức vụ, phòng ban, avatar, chỉ thấy người cùng tổ chức [test: apps/hub-api/src/modules/people/people.int.test.ts » đối tác chỉ thấy thẻ người cùng tổ chức đối tác]

#### Yêu cầu: Ảnh đại diện tối đa 150 KB ở server
Client cắt vuông ≤ 256 px WebP trước khi gửi; server (zod và CHECK 0144) từ chối ảnh lớn hơn 150 KB.
- Kịch bản: khi gửi avatar 200 KB thì bị từ chối ở biên (422) [test: packages/contracts/src/people.test.ts » avatar 200 KB bị từ chối]
- Kịch bản: khi ghi thẳng avatar 200 KB vào DB thì CHECK chặn, 100 KB vẫn được [test: apps/hub-api/src/modules/people/people.int.test.ts » avatar 200 KB bị CHECK 0144 chặn]

#### Yêu cầu: Bình luận mốc `before` sai thì báo lỗi rõ
`GET /posts/:id/comments?dir=desc&before=<id>`: id không tồn tại hoặc không thấy được trên bài này ⇒ 400 `COMMENT_BEFORE_NOT_FOUND`, không trả danh sách rỗng.
- Kịch bản: khi `before` không có hoặc thuộc bài khác thì 400 đúng mã [test: apps/hub-api/src/modules/packs/community/adapters/comments.routes.int.test.ts » before không tồn tại]

#### Yêu cầu: Đổi ảnh bìa công ty ghi người đổi
`PUT /brand/cover` ghi `company_settings.updated_by` = chủ sở hữu vừa đổi.
- Kịch bản: khi chủ sở hữu đổi ảnh bìa thì người cập nhật là chính họ [test: apps/hub-api/src/modules/packs/contracts/company-cover.int.test.ts » ghi người đổi]

### MODIFIED pack-contracts/tin-nhan.md

#### Yêu cầu: Con trỏ danh bạ vừa tên phòng và tên người dài nhất
Con trỏ trang danh bạ chứa tên phòng + tên người nên trần 1024 ký tự (không còn 300).
- Kịch bản: khi tên phòng và tên người dài nhất (tiếng Việt 3 byte) thì con trỏ vẫn qua schema và giải mã đúng [test: apps/hub-api/src/modules/packs/kit/adapters/directory-page.test.ts » tên phòng + tên người dài nhất]

#### Yêu cầu: Thẻ người được lưu theo phiên
Cache thẻ người (avatar, phòng, chức vụ) gắn với tenant + người dùng; đổi phiên ⇒ xoá sạch, kết quả đang bay của phiên cũ bị bỏ; thẻ làm mới thì giao diện cập nhật.
- Kịch bản: khi đổi người dùng hoặc công ty thì thẻ của phiên trước không còn [test: apps/workspace-web/src/features/messages/lib/person-card-store.test.ts » đổi phiên (user/tenant)]
- Kịch bản: khi thẻ hết hạn rồi tải lại thì phiên bản tăng để giao diện cập nhật [test: apps/workspace-web/src/features/messages/lib/person-card-store.test.ts » thẻ hết hạn rồi tải lại]

### MODIFIED engine/company-flows.md

#### Yêu cầu: «Bắt đầu khi» không đọc được thì báo rõ
Điều kiện lưu sai dạng ⇒ API trả `start_when` null + `start_when_unreadable`; trang Quy trình hiện «Không đọc được điều kiện», không hiện «Mọi hợp đồng còn lại».
- Kịch bản: khi điều kiện lưu sai dạng thì trả null kèm cờ không đọc được [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-start-when.test.ts » sai dạng ⇒ null + cờ start_when_unreadable]
- Kịch bản: khi API báo không đọc được thì giao diện đánh dấu điều kiện hỏng [test: apps/workspace-web/src/features/settings/lib/current-flow.test.ts » start_when_unreadable ⇒ startWhenBad]

## Ghi chú thay đổi kỹ thuật
- DB: hub 0144 hạ `people_profiles_avatar_ck` còn 205 000 ký tự (gỡ avatar cũ vượt trần).
- Contract: `AVATAR_MAX_BYTES` 153 600, `AVATAR_MAX_CHARS` 205 000, `MSG_PEOPLE_CURSOR_MAX` 1024, `ApprovalFlowCurrent.start_when_unreadable?`.
- i18n: `contracts.flow.current.unreadable`, `contracts.fview.docxTitle` (vi + en).

## Việc còn lại
- QC: relock test; sửa e2e `cr149/file-preview.spec.ts` (nội dung Word nay trong iframe `docx-frame`).
- Điều phối: e2e cuối đợt.
