---
id: cr118-spec
lát: cr118-spec
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: —
---
## Plan (ngắn)
Chốt tài liệu CR-118 trước khi code: dòng CR, ADR-0034, spec master `docs/specs/CR-118/spec.md`, Delta cho các yêu cầu CR-110/CR-053 bị thay. Gate lại theo Luật 0b: các spec đã deploy (CR-110, CR-053) chỉ "Gate lại" bằng Delta dưới đây + `openspec:check` (làn nhanh, không readiness riêng).

## Làm
- `docs/CHANGE-REQUESTS.md`: dòng CR-118 (Đang làm, 2 đợt, danh sách lát).
- `docs/adr/0034-web-hop-nhat.md` + dòng `docs/adr/README.md`.
- `docs/specs/CR-118/spec.md` (master) + dòng `docs/INDEX.md`.
- Ghi chú "bị thay một phần" ở đầu `docs/specs/cr110-community-unify/README.md`.
- `docs/platform/modules.md`: ghi chú phần engine cộng thêm (kế hoạch, đợt 2); `docs/STATE.md`: một dòng.

## Không làm / Chạm
Không code, không test, không sửa `docs/current/**` (gộp cuối đợt do docs-architect), không CONVENTIONS.md (lát `cr118-move` thêm mục web-module cùng luật depcruise).

## Test tối thiểu
`bun run openspec:check cr118-spec` xanh. Kịch bản dưới đây trỏ `[test: thủ công — …]` vì test do lát sở hữu viết (chưa tồn tại); lát đó thay bằng đường dẫn thật trước khi merge.

## Quyết định trong lúc làm
- ADR-0035/0036 (flow, năng lực) do intake đề xuất được gộp vào ADR-0034 theo yêu cầu điều phối (một ADR).
- Sự kiện SSE đặt tên `config.changed` (cùng kiểu `room.read`, `stream.reset` của `/me/stream`).
- ETag `/pack/me` = cặp version; cache web xoá khi `onEnd` phiên để không lẫn người dùng.
- React 19.2.9 (npm 2026-10-14) thay vì 19.3.x (latest) theo N1 "19.2.x ≥ 2 tuần".

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: COM-FR-31 Routing feed/profile theo đường dẫn (thay hash)
Community chạy như module của web gộp `sohoptac-web`: Bảng tin `/community`, hồ sơ `/community/profile/<orgId>/<section>`, Cài đặt chung là dialog mở bằng `/community?settings=1`; đóng dialog giữ route nền. Link cũ dạng hash được ánh xạ một lần: `#/feed`→`/community`, `#/profile/<o>/<s>`→`/community/profile/<o>/<s>`, `#/settings`→`/community?settings=1`.
- Kịch bản: khi mở link cũ `#/profile/<org>/<section>` thì vào đúng `/community/profile/<org>/<section>` [test: thủ công — unit legacy-hash + e2e ở lát cr118-community-module]
- Kịch bản: khi chuyển giữa Community và Sổ Hợp Tác trong sidebar thì không tải lại trang (dấu `window` còn nguyên) [test: thủ công — e2e unified-nav ở lát cr118-e2e]

#### Yêu cầu: COM-FR-43 Link sang Sổ Hợp Tác là link trong app, cách ly đối tác bằng route + chunk
4 link SHT là điều hướng nội bộ tới đường dẫn gốc của contracts (`/overview`, `/contracts/$id`, `/partners`, `/products`), không còn deep-link `?sec=` sang web khác. Đối tác: DOM không có nhóm SHT, gõ `/contracts` ⇒ về `/community`, 0 request tới chunk contracts và 0 lời gọi `/pack/contracts/*`; server `external-deny` giữ nguyên.
- Kịch bản: khi chủ quản bấm link SHT trong Community thì điều hướng trong cùng app, không đổi host [test: thủ công — e2e unified-nav ở lát cr118-e2e]
- Kịch bản: khi đối tác gõ `/contracts` thì về `/community` và không tải chunk contracts [test: thủ công — e2e partner-isolation ở lát cr118-e2e]

#### Yêu cầu: Đăng nhập Community nằm trong web gộp
Login gộp (form contracts + đổi mật khẩu bắt buộc lần đầu + TOTP) thay màn đăng nhập riêng của community-web; path `/community*` không tự dội sang AI System (đối tác không có chat-web); path SHT giữ dội như nay. `community.<d>/*` trả 301 về `sohoptac.<d>/community`.
- Kịch bản: khi đối tác lần đầu đăng nhập thì buộc đổi mật khẩu rồi vào `/community` [test: thủ công — unit login outcome + e2e ở lát cr118-auth]

### REMOVED community/nghiep-vu.md
#### Yêu cầu: COM-FR-44 SSO hand-off Community → Sổ Hợp Tác
Lý do: cùng một web và một phiên `contracts` nên không còn hand-off giữa hai app; xoá `contracts-link.ts`, `api/session.ts`, `api/auth.ts` phía community-web. Endpoint `/auth/sso/code` + `/sso` giữ cho admin-web/chat-web vào app (catalog `community`: url `https://sohoptac.<d>/community`, `sso=false`).

### MODIFIED admin/tenant-user.md
#### Yêu cầu: Phiên riêng theo app (CR-053) — Community dùng chung phiên `contracts`
Cookie refresh vẫn `ai_rt_<app>` cho từng app web (admin, chat, studio, contracts); app `community` không còn web riêng nên không có cookie `ai_rt_community` ở web mới (`WEB_APPS` giữ `community` để tương thích, không dùng). Người dùng SHT không phải đăng nhập lại; đối tác đăng nhập lại một lần sau khi đổi host. Logic admin-api redeem SSO không đổi (X-App = app của mã).
- Kịch bản: khi người dùng SHT mở `/community` thì dùng phiên `ai_rt_contracts`, không đăng nhập lại [test: thủ công — e2e cs ở lát cr118-e2e]
- Kịch bản: khi redeem mã SSO của app `chat` bằng X-App `contracts` thì bị từ chối như cũ [test: thủ công — giữ int admin-api hiện có, không đổi (lát cr118-auth xác nhận)]

### ADDED web/web-hop-nhat.md
#### Yêu cầu: UW-FR-01..03 Một web, một phiên, module lazy theo manifest
Web nghiệp vụ `apps/sohoptac-web` có một shell/router/phiên; mỗi module khai `manifest.ts` (nav, requires, settings, i18n, slots); module tắt = không DOM, không route con, không tải chunk; đối tác cách ly ở mức route + chunk.
- Kịch bản: khi công ty tắt Community thì nhóm Community biến khỏi sidebar và `/community` về home kèm toast [test: thủ công — e2e toggle feature ở lát cr118-e2e]

#### Yêu cầu: UW-FR-04..06 GET /pack/me, FeatureGate OpenFeature, cập nhật tức thời
`GET /pack/me` trả `{packs, addons, brand, home, versions}` từ ConfigCache (0 SQL nóng, ETag `"<config>.<hub_config>"`, 304); web đọc qua provider OpenFeature mỏng; event SSE `config.changed` trên `/me/stream` kích refetch; dự phòng focus/403/60 s; server fail-closed.
- Kịch bản: khi đổi cấu hình app ở ai-admin thì web nhận `config.changed` và refetch `/pack/me` (304 nếu không đổi) [test: thủ công — int `/pack/me` + e2e ở lát cr118-feature-gate]
- Kịch bản: khi gọi `/pack/me` của công ty khác thì không thấy dữ liệu (chặn chéo tenant) [test: thủ công — int ở lát cr118-feature-gate]

#### Yêu cầu: UW-FR-07..09 Đổi hướng cũ, một i18n/CSS, luật depcruise
`community.<d>` 301 + ánh xạ hash cũ; một instance i18next (khoá `shell.*`, `contracts.*`, `community.*`, ngôn ngữ chung `ai.locale`); CSS Community scope `[data-mod=community]` với `--cm-*`; 6 luật depcruise mức error.
- Kịch bản: khi module `modules/X` import `modules/Y` thì `depcruise` báo lỗi [test: thủ công — chạy `bun run depcruise` ở lát cr118-move]

#### Yêu cầu: UW-FR-10..15 Flow runtime, node form, trang cấu hình app, năng lực (đợt 2, kế hoạch)
Thẻ duyệt HĐ chạy qua `FlowRuntime` + registry renderer; node engine `form` (subset field, validator từ snapshot, quyết + payload cùng transaction); `/apps/$appKey` 5 tab dùng chung `AppCard` với `/tenants/$id`; tenant xem chỉ đọc ở Cài đặt › "Ứng dụng & quy trình"; read-model `TenantCapabilityView` (không migration).
- Kịch bản: khi gửi hành động form hai lần thì chỉ một lần có hiệu lực (idempotent) [test: thủ công — int ở lát cr118-node-form]

## Việc còn lại
- Gộp Delta vào `docs/current/**` cuối đợt (docs-architect); đổi `[test: thủ công …]` thành đường dẫn test thật khi lát sở hữu viết xong.
- CONVENTIONS.md mục web-module + luật depcruise: lát `cr118-move`.
