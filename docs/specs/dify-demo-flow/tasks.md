# dify-demo-flow — nối MỘT flow Dify thật vào sohoptac2 (Luật 0b, làn nhanh)

**Chốt:** Dify `langgenius/dify-api:1.14.2` (DSL 0.6.0) tại https://dify.evoluconsulting.com (project `dify-001`). Mạng `sohoptac2_default`
KHÔNG tới được `dify-001_default` ⇒ gọi qua URL công khai: base_url = `https://dify.evoluconsulting.com/v1` (đã dò từ hub-api: 401 khi không key = tới được).

**Dùng đường sẵn có, không engine mới:** lệnh `/han-muc-duyet <giá trị> <Mua|Bán|Giới thiệu> [đối tác]` (sync, `commandDriver` của Hub) → workflow Dify
→ `hub.dify_runs` + `hub.usage_logs` (đã có sẵn ở driver, test int xác nhận). Không làm tool cho `assistant` (lệnh đủ cho demo).
Bật chỉ cho tenant demo = feature `han-muc-duyet` chỉ có entitlement tenant đó; grant cho các Group có quyền `contracts-read`.

| Việc | File |
|---|---|
| DSL workflow không LLM (start → code QC-TC-01 → end) | `deploy/prod-sohoptac2/dify/han-muc-duyet.yml` |
| Đăng ký idempotent (secret + workflow + feature + command + grant) | `tools/scripts/src/dify-register.ts` (+ `.rules.ts`, `.test.ts`) |
| `DIFY_CONSOLE_URL` | `deploy/prod-sohoptac2/gen-env.sh` (đặt nếu vắng), `env.template` |
| int (mock Dify) | `apps/hub-api/src/modules/commands/han-muc-duyet.int.test.ts` — xanh trên evotest |
| e2e triển khai (chưa chạy) | `e2e/deployed/12-han-muc-duyet.deployed.ts` |

Quyết định: kết quả chat = một chuỗi (Hub chỉ hiện một output_field) ⇒ End vẫn xuất approvers/level/note, lệnh hiển thị `note` (đã chứa chuỗi duyệt).
`seed-dify-live.*` chỉ nới kiểu (`select/number`, `dify_app_id`) để dùng lại bước ghi.

## Việc còn lại (người dùng)
1. Dify console → Studio → Import DSL → `han-muc-duyet.yml` → Publish → API Access: chép **App ID** (UUID trong URL) + **API Key**.
2. Máy chủ (xem lệnh trong báo cáo) chạy `dify-register --apply`; rồi e2e: `e2e-deployed.ps1 -Spec e2e/deployed/12-han-muc-duyet.deployed.ts`.
