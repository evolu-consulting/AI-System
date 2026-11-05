# Web hợp nhất `workspace-web` (UW-FR)

Cập nhật: 2026-11-04 · Nguồn: CR-118 (cr118-spec). Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: UW-FR-01..03 Một web, một phiên, module lazy theo manifest (nguồn: cr118-spec)
Web nghiệp vụ `apps/workspace-web` có một shell/router/phiên; mỗi module khai `manifest.ts` (nav, requires, settings, i18n, slots); module tắt = không DOM, không route con, không tải chunk; đối tác cách ly ở mức route + chunk.
- Kịch bản: khi công ty tắt Community thì nhóm Community biến khỏi sidebar và `/community` về home kèm toast [test: thủ công — e2e toggle feature ở lát cr118-e2e]

#### Yêu cầu: UW-FR-04..06 GET /pack/me, FeatureGate OpenFeature, cập nhật tức thời (nguồn: cr118-spec)
`GET /pack/me` trả `{packs, addons, brand, home, versions}` từ ConfigCache (0 SQL nóng, ETag `"<config>.<hub_config>"`, 304); web đọc qua provider OpenFeature mỏng; event SSE `config.changed` trên `/me/stream` kích refetch; dự phòng focus/403/60 s; server fail-closed.
- Kịch bản: khi đổi cấu hình app ở ai-admin thì web nhận `config.changed` và refetch `/pack/me` (304 nếu không đổi) [test: thủ công — int `/pack/me` + e2e ở lát cr118-feature-gate]
- Kịch bản: khi gọi `/pack/me` của công ty khác thì không thấy dữ liệu (chặn chéo tenant) [test: thủ công — int ở lát cr118-feature-gate]

#### Yêu cầu: UW-FR-07..09 Đổi hướng cũ, một i18n/CSS, luật depcruise (nguồn: cr118-spec)
`community.<d>` 301 + ánh xạ hash cũ; một instance i18next (khoá `shell.*`, `contracts.*`, `community.*`, ngôn ngữ chung `ai.locale`); CSS Community scope `[data-mod=community]` với `--cm-*`; 6 luật depcruise mức error.
- Kịch bản: khi module `modules/X` import `modules/Y` thì `depcruise` báo lỗi [test: thủ công — chạy `bun run depcruise` ở lát cr118-move]

#### Yêu cầu: UW-FR-10..15 Flow runtime, node form, trang cấu hình app, năng lực (đợt 2, kế hoạch) (nguồn: cr118-spec)
Thẻ duyệt HĐ chạy qua `FlowRuntime` + registry renderer; node engine `form` (subset field, validator từ snapshot, quyết + payload cùng transaction); `/apps/$appKey` 5 tab dùng chung `AppCard` với `/tenants/$id`; tenant xem chỉ đọc ở Cài đặt › "Ứng dụng & quy trình"; read-model `TenantCapabilityView` (không migration).
- Kịch bản: khi gửi hành động form hai lần thì chỉ một lần có hiệu lực (idempotent) [test: thủ công — int ở lát cr118-node-form]
