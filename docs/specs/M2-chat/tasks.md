# Tasks · M2-chat — trợ lý AI trong app mgmt (contracts-web) qua Agent Hub

Quyết định người dùng 2026-10-19: contracts-web là app "mgmt"; chat tách khỏi app, Agent Hub quản lý; "hiện tại dùng Dify đi
nếu nhanh"; engine workflow đóng băng. Chế độ một agent đi thẳng, review + security cuối đợt.

## Quyết định kỹ thuật

- **Một agent dùng chung** `mgmt-assistant` (Hub). Panel gửi `@mgmt-assistant <câu hỏi>` vào hội thoại Hub (E6/E12, SSE) —
  chạy thẳng agent (H2b), không qua Orchestrator. Đổi backend = đổi cấu hình agent (runtime), panel không đổi.
- **Dify không gọi được tool với quyền NGƯỜI GỌI**: custom tool (OpenAPI) và MCP của Dify chỉ có header/khoá tĩnh theo app;
  Dify không chuyển danh tính người dùng sang lời gọi tool ⇒ chỉ có thể dùng tài khoản dịch vụ (cấm). Vì vậy:
  - `runtime: dify-agent` (+ `workflow_key` = app chat Dify) ⇒ trò chuyện KHÔNG tool.
  - `runtime: agentic-cli` (Claude) + `runtime_options.pack_tools` ⇒ có tool qua `/mcp` của Hub, token job = user + tenant
    của run ⇒ `withPackScope` (RLS) của đúng người gọi. Nhanh hơn: mọi đường ống đã có (N2), chỉ thiếu nối `pack_tools`.
  - Seed mặc định: `agentic-cli` + tool (chạy được không cần khoá). Chuyển sang Dify: Admin tạo workflow catalog app chat
    Dify (base URL + app key — secret), Studio sửa agent `mgmt-assistant` → runtime `dify-agent` + workflow đó.
- **Tool chỉ đọc** (gói `contracts`, `action: read`, không side_effect), chạy `PackUow.tenant(user)`:
  `contracts-search`, `contracts-get`, `contracts-cks`, `contracts-ledger`.
  Ghi (để sau, dạng thẻ xác nhận như mgmt-app): sửa trường HĐ, ghi đã thanh toán/hoãn/nhắc đợt, bán/gia hạn CKS, gắn phụ lục.

| # | Task | Rủi ro | File | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|
| T1 | Tool đọc gói contracts (4 tool) + đăng ký registry ở `mountContracts` | cao (quyền) | `packs/contracts/adapters/assistant.tools.ts`, `packs.mount.ts` | unit + int evotest | [ ] |
| T2 | `runtime_options.pack_tools` của agent `agentic-cli` → `payload.mcp.tools` | cao (quyền) | `runner/job/job-agent-runner.ts` | unit | [ ] |
| T3 | Seed agent `mgmt-assistant` (+ entitlement/grant) | thường | `apps/hub-api/seed/agents.yaml`, `access.yaml` | seed test | [ ] |
| T4 | Panel trợ lý contracts-web (hội thoại Hub, SSE, Markdown nhẹ) + proxy `/conversations` `/runs` | thường | `apps/contracts-web/src/features/assistant/*` | unit + e2e `assistant.cw.ts` | [ ] |
| T5 | Int: dify-agent `mgmt-assistant` qua Dify giả đầu-cuối; tool qua `/mcp` với RLS người gọi | cao | `tests/acceptance/M2-chat/*` | evotest int | [ ] |

## Cần từ người dùng

- `DIFY_API_URL` (base URL Dify) + app API key của app chat trợ lý — chỉ qua env/secret Admin, không commit.
