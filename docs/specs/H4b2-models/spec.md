---
id: H4b2-models
title: H4b-2 · Models (provider, profile, trạng thái sống) + Quyền agent (entitlement agent × tenant)
milestone: H4b-2 (phần còn lại của H4b; mở 2026-10-13 sau CR-074 bỏ K2)
status: draft            # chưa PLAN/qc/readiness/Gate
requirements: [HUB-FR-66, HUB-FR-67, HUB-FR-78, HUB-FR-77, HUB-BR-17, AC-H04, AC-H4b2-01, AC-H4b2-02, AC-H4b2-03, AC-H4b2-04, AC-H4b2-05, AC-H4b2-06]
design:
  - docs/design/agent-hub/ba-agent-hub.md HUB-FR-66, HUB-FR-67 (dòng ~209–210) · HUB-FR-77, HUB-FR-78 (~227–228) · HUB-BR-17 (~359) · AC-H04 · bảng `providers`, `provider_state` (~378, ~388)
  - docs/design/agent-hub/ui-agent-studio.md §8 Models (dòng 120) · §9 Quyền agent (130) · flow F3, F5 · §13 Validation & trạng thái
  - canvas: docs/design/agent-hub/canvas/Models.dc.html (§8), Access.dc.html (§9)
  - nền: docs/specs/H4b1-secrets/spec.md (kho `hub.secrets`, `provider_api_key`, `useSecret`, "Được dùng bởi") · H4a (Studio khung, audit, `hub_config_version`)
owner: backend-lead + frontend-lead + qc
---

# H4b-2 · Models + Quyền agent

## 1. Phạm vi
**Làm:**
- CRUD **provider** (key, loại `api`|`subscription-cli`, hãng, base URL, `max_concurrency`, `enabled`) và gắn `providers.secret_id` → secret `provider_api_key` của H4b-1 (HUB-FR-66). Xoá secret đang được provider dùng bị chặn (đã có "Được dùng bởi" ở H4b-1).
- Trạng thái sống `provider_state` (ok/busy/cooldown/error/logged_out, slot dùng/tổng, `cooldown_until`, `last_error`) hiện ở bảng Providers.
- **"Kiểm tra key"** (loại `api`) và **"Kiểm tra lại"** (subscription): kết quả ok/lỗi nguyên văn trong khối "Chi tiết" (ui-admin P7); không ghi key vào log/audit.
- CRUD **model profile**: chuỗi bước (provider + model) kéo-thả, điều kiện chuyển `error|quota|timeout`; cảnh báo profile toàn subscription (HUB-FR-67; AC-H04).
- **Entitlement agent × tenant** (HUB-FR-78 phần `platform_admin`): ma trận + drawer xem grant + thu hồi (ConfirmDialog), hiệu lực ≤ 5 s, grant giữ lại khi thu hồi; audit + tăng `hub_config_version`. Kiểm quyền dùng agent (HUB-FR-77) chỉ là bối cảnh — logic đã có ở `agent-grants`; spec này thêm nguồn ghi entitlement và không đổi công thức.
- HUB-BR-17: `tenant_admin` chỉ cấp agent đã có entitlement (kiểm lại khi thu hồi; không đổi UI Admin › Groups).

**Không làm:** tab **Đơn giá** (`price_book`, Studio §8) — không thuộc FR của mốc, để mốc cost/quota; chạy thật provider `api` (chờ H2d; dev dùng `fake-*`); đăng nhập CLI subscription (runbook Worker, chỉ hiện hướng dẫn); cấp grant (ở Admin, HUB-FR-78 phần `tenant_admin`); nạp tri thức vào KH (K2 đã bỏ, CR-074).

## 2. Nghiệp vụ
Nguồn chính: BA HUB-FR-66/67/77/78, HUB-BR-17; UI Studio §8, §9. Chỉ ghi phần cụ thể hoá.

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| Quyền thao tác | Chỉ `platform_admin` (tenant `platform`) CRUD provider/profile và đổi entitlement; role khác → 403 | HUB-FR-78 |
| Provider `api` | Bắt buộc `secret_id` trỏ secret `provider_api_key` còn tồn tại; loại `subscription-cli` không có secret, có `max_concurrency` ≥ 1 | HUB-FR-66, H4b-1 |
| Xoá provider | Chặn nếu còn profile dùng (409 kèm danh sách profile); chỉ tắt (`enabled=false`) thì profile tự dự phòng bước kế | HUB-FR-67 (đề xuất, Q2) |
| Profile | ≥ 1 bước; mỗi bước (provider, model, điều kiện chuyển); thứ tự = thứ tự thử; dòng tóm tắt "lúc này chạy bằng" tính từ `provider_state` | UI §8 |
| Thu hồi entitlement | Grant giữ nguyên (khôi phục khi cấp lại) nhưng không còn hiệu lực; run đang chạy xong; agent tắt: entitlement vẫn giữ, cột mờ | HUB-FR-78, UI §9 |
| Nhật ký | Mọi ghi → audit (không có giá trị secret) + `hub_config_version` +1 | HUB-FR-69, HUB-FR-78 |

## 3. Contract (backend-lead)
<!-- backend-lead -->

## 4. Dữ liệu (backend-lead)
<!-- backend-lead --> Bảng theo BA: `providers`, `provider_state`, `model_profiles`, `agent_entitlements`; đối chiếu migration thật trước khi thêm (entitlement đã có đọc ở `agent-grants`).

## 5. UI (frontend-lead)
<!-- frontend-lead -->

**Artboard (đối chiếu 2026-10-13):**

| Màn | Artboard | Tình trạng |
|---|---|---|
| Models › Providers (bảng, trạng thái, slot, cooldown) | `canvas/Models.dc.html` | Có |
| Models › Profiles (StepsEditor) | `canvas/Models.dc.html` | Có (một khung) |
| Quyền agent: ma trận agent × tenant | `canvas/Access.dc.html` | Có |
| Quyền agent: drawer ô (ngày cấp, người cấp, grant) | `canvas/Access.dc.html` | Có |
| Quyền agent: ConfirmDialog thu hồi | `canvas/Access.dc.html` | Có (chỉ nhắc "Thu hồi"; câu chữ "N grant… mất hiệu lực" theo UI §9) |
| Sheet sửa Provider (SecretField, `max_concurrency`) | — | **Thiếu** — theo mẫu Sheet Secrets (H4b-1) |
| Kết quả "Kiểm tra key" / "Kiểm tra lại" (ok · lỗi · đang chạy) | — | **Thiếu** — khối "Chi tiết" (ui-admin P7) |
| Sheet runbook "Hướng dẫn" đăng nhập CLI (F3) | — | **Thiếu** |
| Trạng thái rỗng / lỗi / không quyền các màn trên | — | **Thiếu** — theo mẫu `docs/design/canvas/States.dc.html` |
| Tab Đơn giá | `Models.dc.html` | Có nhưng **ngoài phạm vi** mốc này |

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6. Hiệu lực entitlement/cấu hình ≤ 5 s (AC-H05, `hub_config_version` sẵn có).

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Secret provider (H4b-1) | `hub.secrets` thật trong DB test |
| API provider thật cho "Kiểm tra key" | Provider `fake-*` / mock HTTP; không gọi mạng thật |
| Worker/CLI subscription | `ai-hub-dev-runtime` (fake-cli); `provider_state` ghi tay trong test |

## 8. Tiêu chí nghiệm thu (qc)
Từ BA/UI; qc bổ sung dữ liệu cụ thể khi viết test (trước code).

| AC | Given / When / Then | Test |
|---|---|---|
| AC-H04 | Theo BA AC-H04: profile *smart* = anthropic-api → openai-api, anthropic trả 429 → trả lời từ openai, trace ghi `provider=openai-api` + lý do dự phòng | <!-- qc --> |
| AC-H4b2-01 | `platform_admin` tạo provider `api` gắn secret H4b-1 → có trong danh sách với `secret_id`, không lộ giá trị; role khác → 403 | <!-- qc --> |
| AC-H4b2-02 | "Kiểm tra key" key sai/đúng (mock) → khối Chi tiết hiện lỗi nguyên văn / ok; log + audit không chứa key | <!-- qc --> |
| AC-H4b2-03 | Profile 2 bước, thứ tự kéo-thả lưu đúng; xoá provider đang được profile dùng → 409 kèm tên profile | <!-- qc --> |
| AC-H4b2-04 | Cấp entitlement agent A cho `acme` ở ma trận → ≤ 5 s user `acme` được cấp grant dùng được A; audit + `hub_config_version` +1 (HUB-FR-77/78) | <!-- qc --> |
| AC-H4b2-05 | Thu hồi entitlement có 2 grant → ConfirmDialog nêu "2 grant"; sau xác nhận agent biến khỏi danh sách user; cấp lại → grant tự có hiệu lực; run đang chạy vẫn xong | <!-- qc --> |
| AC-H4b2-06 | `tenant_admin` `acme` cấp agent chưa có entitlement → từ chối (HUB-BR-17); không thấy entitlement tenant khác | <!-- qc --> |

Lệnh xong: `bun run typecheck && bun test && bun run test:int && bunx playwright test h4b2` (`done:h4b` theo ROADMAP).

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- 2026-10-13: thứ tự H4b-1 → K1 → H4b-2 → P-c; K2 bỏ (CR-074).
### Câu hỏi mở (mặc định đề xuất, chờ readiness)
- Q1 Tab Đơn giá ngoài mốc. Mặc định: ngoài.
- Q2 Xoá provider đang được profile dùng → 409 (không cascade). Mặc định: 409.
- Q3 "Kiểm tra key" gọi endpoint liệt kê model của hãng, timeout 10 s; hãng chưa hỗ trợ → "Chưa hỗ trợ kiểm tra". Mặc định: vậy.
### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

## 10. Tranh chấp test
- (không)
