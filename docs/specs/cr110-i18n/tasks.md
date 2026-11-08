---
id: cr110-i18n
lát: cr110-i18n
cr: CR-110
fr: COM-FR-46
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Hạ tầng i18n VI/EN cho community-web (làm trước các lát CR-110 khác): một namespace `community.*` lồng theo tính năng tại `packages/i18n/locales/community/{vi,en}.json`; i18next + react-i18next; VI là gốc + dự phòng (gói tĩnh, dùng đồng bộ cả trong logic thuần), EN nạp động; lưu `community.lang`.

## Làm
- [x] `@ai/i18n/community-locales` (`loadCommunityLocale`, `communityVi`); `i18n:check` so khoá vi/en của `community/`.
- [x] `community-web/src/i18n`: `pickLocale` (đã lưu → `/me` → vi), `setLang`, `initLang`, `t`; App dựng lại cây khi đổi ngôn ngữ; Đăng nhập dùng chung (gộp `login-i18n.ts`).
- [x] Chuyển mọi chuỗi VI viết thẳng ở feed, composer, post card, thread, quote, profile, settings, dock, login sang khoá; bản EN đề xuất (Q11: rà ở UAT).
- [x] Luật test `no-hardcoded-vi.test.ts`: chuỗi có dấu trong `ui/` + `lib/` (trừ test, `i18n-ignore`, mock/regex) làm đỏ.

## Không làm / Chạm
Không đổi dữ liệu mock/seed (`api/`), nội dung server (thông báo, mặt nạ liên hệ), e2e khoá. Mặc định vi nên `e2e/community-web/feed.cm.ts` giữ nguyên.

## Test tối thiểu
Unit: `src/i18n/i18n.test.ts` (chọn ngôn ngữ, loader, rơi về VI, khoá dùng trong mã có trong VI), `no-hardcoded-vi.test.ts`; test cũ giữ xanh.

## Quyết định trong lúc làm
- Khoá lưu `community.lang` (đọc thêm khoá cũ `community:lang`). Mặc định vi, không dò trình duyệt (khớp e2e vi-VN).
- Lát khác thêm khoá vào cùng 2 file JSON, lồng theo tính năng.
- Chữ có dấu bắt buộc giữ (regex dò, hậu tố tiền) đánh dấu `// i18n-ignore`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED current/community/i18n.md
#### Yêu cầu: Community VI/EN (COM-FR-46)
Giao diện community-web có hai ngôn ngữ vi/en từ một namespace `community.*`; thiếu bản EN thì hiện VI; ngôn ngữ chọn lưu `community.lang`, mặc định vi; không chuỗi tiếng Việt viết thẳng trong mã UI.
- Kịch bản: khi chưa chọn ngôn ngữ thì dùng vi, đã lưu hoặc `/me` thì dùng giá trị đó [test: apps/workspace-web/src/modules/community/i18n/i18n.test.ts]
- Kịch bản: khi đổi sang en thì chuỗi hiện EN, khoá thiếu ở EN rơi về VI [test: apps/workspace-web/src/modules/community/i18n/i18n.test.ts » loader + t]
- Kịch bản: khi thêm chuỗi tiếng Việt có dấu vào mã UI thì test đỏ [test: apps/workspace-web/src/modules/community/i18n/no-hardcoded-vi.test.ts » không có chuỗi tiếng Việt viết thẳng trong mã UI/lib (trừ test)]

## Việc còn lại
Rà bản EN ở UAT (Q11). Các lát shell/feed/profile-ui/settings thêm khoá vào `community/{vi,en}.json`.