---
id: H4b1-secrets
title: H4b-1 · Secrets của Hub (chỉ ghi, AES-256-GCM) — provider key, source_credential, khoá KnowledgeHub
milestone: H4b-1 (tách từ H4b, người dùng 2026-10-13: ưu tiên ai-sdlc)
status: draft            # khung do docs-architect 2026-10-13; chưa PLAN/readiness/Gate
requirements: [HUB-FR-68, HUB-FR-69, HUB-BR-30, HUB-BR-15, AC-H4b1-01, AC-H4b1-02, AC-H4b1-03, AC-H4b1-04, AC-H4b1-05, AC-H4b1-06, AC-H4b1-07, AC-H4b1-08]
design:
  - docs/design/agent-hub/ba-agent-hub.md#HUB-FR-68 (dòng ~211) · HUB-FR-04 (dòng ~137, key riêng, không log) · HUB-FR-69 (audit)
  - docs/design/agent-hub/ba-agent-hub.md HUB-FR-120 (nguồn `git_remote` repo riêng → secret `source_credential`, CR-060) · HUB-FR-129 · HUB-BR-30
  - docs/design/agent-hub/ba-agent-hub.md HUB-FR-131 (khoá KH = secret chỉ ghi) · HUB-BR-36/37
  - docs/design/agent-hub/ui-agent-studio.md §11 "Secrets" (dòng ~152–156), §ràng buộc xoá "Được dùng bởi" (dòng ~223); SecretField: docs/design/admin/ui-admin.md
  - docs/adr/0012-knowledgehub-external-rag.md §1 (quyết định 1) · docs/CHANGE-REQUESTS.md#CR-060 · #CR-062
  - nền: H4a (Studio khung, audit + `hub_config_version`) · ADM secrets M2 (`admin.secrets`, mẫu mã hoá — tham khảo, KHÔNG dùng chung key)
owner: backend-lead + frontend-lead + qc
---

# H4b-1 · Secrets của Hub

Tách từ H4b (ROADMAP). Phần còn lại của H4b (Models, `provider_state` UI, entitlement agent × tenant) → H4b-2. Spec này **chỉ khung**: mục 3–5 do backend-lead/frontend-lead; Gate chưa qua.

## 1. Phạm vi
**Làm:**
- Kho secret của Hub (`hub.secrets`), mã hoá AES-256-GCM bằng `HUB_SECRETS_KEY` (khác master key Admin), **chỉ ghi, không đọc lại**.
- Ba loại: `provider_api_key` (API key provider), `source_credential` (CR-060: token repo git riêng của nguồn), `kh_api_key` (khoá KnowledgeHub, ADR-0012 §1).
- API ghi/thay/xoá/liệt kê metadata (không giá trị) + "Được dùng bởi"; audit (không có giá trị) + `hub_config_version`.
- Hàm nội bộ giải mã tại điểm dùng (`useSecret`) cho các mốc sau (K1, P-c, provider `api`); không endpoint đọc.
- Studio: màn Secrets (drawer, SecretField, chỉ ghi) — loại `provider_api_key` và `kh_api_key`.

**Không làm:** CRUD provider/profile, "Kiểm tra key" (cần provider → H4b-2); trang KnowledgeHub + kiểm tra kết nối (K1); clone/fetch repo riêng bằng `source_credential` (P-c/sau); xoay `HUB_SECRETS_KEY` (xem Q3); app-key workflow (vẫn ở Admin).

## 2. Nghiệp vụ
Trỏ BA, chỉ ghi phần cụ thể hoá.

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| Chỉ ghi | Không API/log/audit/export nào trả giá trị; chỉ trả metadata (`id`, `kind`, `name`, `version`, `updated_at`, `used_by[]`) | HUB-FR-68, HUB-FR-04 |
| Mã hoá | AES-256-GCM, IV 12 byte ngẫu nhiên mỗi lần ghi, AAD = `id‖kind‖tenant_id`; `HUB_SECRETS_KEY` 32 byte, thiếu/sai độ dài ⇒ Hub không khởi động | HUB-FR-68, Q2 |
| Phạm vi | `provider_api_key`, `kh_api_key`: toàn nền tảng, chỉ `platform_admin`. `source_credential`: gắn `tenant_id` (RLS); ghi bởi `tenant_admin` của tenant đó hoặc `platform_admin` | HUB-BR-15, CR-060, Q1 |
| Không vào job | Giải mã chỉ trong tiến trình Hub (và Runtime-chương-trình cho `source_credential` ở mốc sau); không bao giờ vào `work/<job_id>/`, prompt, trace, audit | HUB-BR-30, ADR-0012 §1 |
| Thay giá trị | Ghi đè = giá trị mới, `version + 1`, audit `secret.rotate` (không giá trị); chống ghi đè đồng thời bằng `version` | HUB-FR-69 |
| Xoá | Chặn `409` khi còn được dùng (provider/source/KH trỏ tới); trả danh sách "Được dùng bởi" | ui-agent-studio §ràng buộc xoá |
| Tên | `name` duy nhất theo (kind, tenant); `^[A-Za-z0-9_-]{2,64}$` (khớp quy ước secrets Admin) | Q4 |

## 3. Contract (backend-lead)
<!-- backend-lead -->
File dự kiến: `packages/contracts/src/hub-admin/secrets.ts`. Endpoint ngoài `/studio/api/secrets*` cho `source_credential` của tenant: Q1.

## 4. Dữ liệu (backend-lead)
<!-- backend-lead -->
Dự kiến `hub.secrets(id, kind, tenant_id NULL, name, ciphertext, iv, version, created_at, updated_at)` + RLS + `REVOKE` cột ciphertext khỏi vai không cần; `hub.providers.secret_id` hiện là `uuid` không FK (`packages/db/src/schema/hub.ts`) — Q5.

## 5. UI (frontend-lead)
<!-- frontend-lead -->
Studio `/studio/secrets` (drawer, SecretField, trạng thái tải/rỗng/lỗi/không quyền). Artboard: chưa có riêng (ui-agent-studio §11) — dựng theo SecretField + DataTable của Admin.

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6 (không siết thêm; perf không chặn mốc).

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| `HUB_SECRETS_KEY` | `bun run keys:dev` sinh khoá dev (Q6); test dùng khoá cố định trong fixture |
| Studio khung + audit/`hub_config_version` | Có sẵn từ H4a |
| Provider/KH/source dùng secret | Chưa có ở mốc này ⇒ `used_by` rỗng; test chèn bản ghi tham chiếu giả |

Env mới: `HUB_SECRETS_KEY` (base64 32 byte).

## 8. Tiêu chí nghiệm thu (qc)
| AC | Given / When / Then | Test |
|---|---|---|
| AC-H4b1-01 | `platform_admin` tạo `provider_api_key` "anthropic-main" ⇒ 201 chỉ có metadata; mọi GET/list/audit/log không chứa giá trị | <!-- qc --> |
| AC-H4b1-02 | DB: `ciphertext` ≠ plaintext, IV khác nhau giữa hai lần ghi cùng giá trị; sửa 1 byte ciphertext hoặc đổi `kind`/`tenant_id` ⇒ giải mã thất bại (AAD) | |
| AC-H4b1-03 | Thay giá trị với `version` cũ ⇒ 409 `VERSION_CONFLICT`; đúng `version` ⇒ `version+1`, audit `secret.rotate` không giá trị | |
| AC-H4b1-04 | Xoá secret đang được tham chiếu ⇒ 409 kèm `used_by[]`; không tham chiếu ⇒ 204 + audit | |
| AC-H4b1-05 | `source_credential` của tenant A: tenant_admin B GET/PUT/DELETE ⇒ 404; `tenant_admin` không ghi được `provider_api_key`/`kh_api_key` ⇒ 403 | |
| AC-H4b1-06 | Hub khởi động thiếu/sai độ dài `HUB_SECRETS_KEY` ⇒ thoát có thông báo rõ, không log khoá | |
| AC-H4b1-07 | Chuỗi giá trị secret không xuất hiện trong log Hub, trace run, `work/<job_id>/` (job giả dùng `useSecret`) | |
| AC-H4b1-08 | e2e Studio: nhập key trong SecretField, lưu ⇒ hiện "Đã lưu" + metadata, không có nút xem; ô nhập rỗng lại | |

Lệnh xong: `bun run typecheck && bun test && bun run test:int && bunx playwright test e2e/H4b1` (đề xuất `done:h4b1`).

## 9. Quyết định
### Trước Gate — câu hỏi mở (mặc định đề xuất; người dùng/Gate xác nhận)
| # | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Ai ghi `source_credential`: `platform_admin` hay `tenant_admin` của nguồn? UI ở đâu? | Cả hai (RLS theo `tenant_id`). H4b-1 chỉ làm API `/studio/api/secrets` (platform_admin, mọi tenant) + API tenant `POST/PUT/DELETE /secrets/source-credentials` (tenant_admin); UI cho tenant_admin nằm ở màn Nguồn (ADM-FR-68) khi P-c/mốc sau cần, **không** làm trong H4b-1 |
| Q2 | Khoá & AAD | `HUB_SECRETS_KEY` 32 byte base64; AAD = `id‖kind‖tenant_id` |
| Q3 | Xoay khoá `HUB_SECRETS_KEY` | Chưa làm; cột `key_version smallint default 1` để chừa chỗ; mốc riêng khi cần |
| Q4 | Quy ước `name` | Như trên §2; duy nhất theo (kind, tenant_id) |
| Q5 | `providers.secret_id` thêm FK tới `hub.secrets`? | Thêm FK nullable `ON DELETE RESTRICT` trong migration H4b-1 nếu bảng providers chưa có dữ liệu mồ côi; nếu có ⇒ để H4b-2 |
| Q6 | Khoá dev | `keys:dev` thêm `HUB_SECRETS_KEY` vào `.env.local`; CI dùng khoá cố định test |
| Q7 | Loại `kh_api_key`: một bản toàn nền tảng hay theo tenant? | Một bản toàn nền tảng (KH khai báo ở Studio → Cài đặt, HUB-FR-131); project theo tenant do K1 |
| Q8 | Có "Kiểm tra key" ở H4b-1? | Không (H4b-2, cần provider); `kh_api_key` kiểm kết nối ở K1 |
| Q9 | Bậc rủi ro task BUILD | Cao (secrets/mã hoá/RLS ⇒ Opus) + security review riêng |
| Q10 | Hard stop | Mặc định đã chấp nhận (ADR-0012 §1: khoá chỉ ở Hub, chỉ ghi); không cần dịch vụ trả tiền/secret thật |

### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

## 10. Tranh chấp test
- (không)
