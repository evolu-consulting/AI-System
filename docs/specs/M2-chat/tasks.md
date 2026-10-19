# Tasks · M2-chat — trợ lý AI trong app mgmt (contracts-web) qua Agent Hub

Quyết định người dùng 2026-10-19: contracts-web là app "mgmt"; chat tách khỏi app, Agent Hub quản lý; "hiện tại dùng Dify đi
nếu nhanh"; engine workflow đóng băng. Chế độ một agent đi thẳng, review + security cuối đợt. Bổ sung cùng ngày (người dùng
duyệt): token ngắn hạn cho Dify gọi tool, kế hoạch thoát Dify → Claude, usage chat theo tenant.

## Quyết định kỹ thuật

- **Một agent dùng chung** `mgmt-assistant` (Hub). Khoang gửi `@mgmt-assistant <câu hỏi>` (+ `context.page_url`) vào hội
  thoại Hub (E6/E12, SSE) — chạy thẳng agent (H2b), không qua Orchestrator. Khoang không biết backend là Dify hay Claude.
- **Tool chỉ đọc** (gói `contracts`, `action: read`, không side_effect), chạy `PackUow.tenant(user)` = role `contracts_rw` +
  `app.tenant_id` + `app.user_id` của NGƯỜI GỌI (RLS, gồm luật M1D phòng ban): `contracts-search`, `contracts-get`,
  `contracts-cks`, `contracts-ledger`. Agent khai danh sách ở `runtime_options.pack_tools`; `/mcp` lọc tiếp (registry, gói bật
  cho tenant, quyền gói `read` của người gọi). Ghi để sau, dạng thẻ xác nhận như mgmt-app: sửa trường HĐ, ghi đã trả/hoãn/nhắc
  đợt, bán/gia hạn CKS, gắn phụ lục.
- **Claude** (`agentic-cli`): `pack_tools` → `payload.mcp.tools`; CLI gọi `/mcp` bằng token job (= user + tenant của run).
- **Dify** (`dify-agent`): Dify custom tool/MCP chỉ có khoá tĩnh ⇒ không dùng. Hub cấp **token chat ngắn hạn** cho ĐÚNG một tin:
  `hct_` + 32 byte ngẫu nhiên, Redis lưu theo sha256 (không bản rõ), claims = tenant + user + run + hội thoại + agent + tool
  đọc; TTL = hạn agent kẹp [60 s, 15 phút] + `exp` kiểm lại; chỉ tool `action: read` không side_effect (lọc lúc cấp và lúc
  dùng); **thu hồi khi run kết thúc** (kể cả lỗi/huỷ). Hub tiêm vào `inputs.hub_tool_token` của tin gửi Dify; app Dify dùng
  làm `Authorization: Bearer` khi gọi `POST /mcp` của Hub. Bản Dify lưu trong log vô dụng sau run. Không token dài hạn/dịch vụ.
  Cấp chỉ khi agent có `pack_tools` VÀ app Dify khai input `hub_tool_token` (cấu hình).
- **Usage chat theo tenant**: mọi bước agent của chat (Dify lẫn Claude) đi qua `runJob` ⇒ `noteChatUsage` →
  `recordChatUsage` (`modules/usage/chat-usage.ts`). Bảng dùng chung là của M3: tới khi có, sink mặc định log `chat-usage`;
  M3 gọi `setChatUsageSink` trỏ vào bảng. Dify vẫn ghi thêm `hub.log_dify_usage` như cũ.

## Kế hoạch thoát: Dify → Claude (chỉ cấu hình)

Seed sẵn CẢ HAI (quyết định coordinator 2026-10-20, không có Dify thật): `mgmt-assistant` = Claude (`agentic-cli`, tool đọc qua
token job) — mặc định; `mgmt-assistant-dify` = Dify (`dify-agent`, workflow Admin `mgmt-assistant`, tool đọc qua token chat).
**Cờ chọn backend**: env build contracts-web `PUBLIC_ASSISTANT_AGENT` (vắng ⇒ `mgmt-assistant`; `mgmt-assistant-dify` ⇒ Dify).
Grant `mgmt-assistant`: Group vai gói contracts (`contracts-viewer/editor/owner`) + `beta-testers` ở acme; khi bật Dify cấp
entitlement/grant tương tự cho `mgmt-assistant-dify` (Studio).

Điều kiện chạy Claude thật: provider `claude-sub` + profile `claude-sub-1` (seed với `HUB_SEED_PROFILE=claude-sub-1`, dev mặc
định `fake-1`); `HUB_PUBLIC_INTERNAL_URL` đặt (thiếu ⇒ job CLI không có `/mcp` ⇒ trả lời KHÔNG tool); Agent Runtime chạy.
Cách thứ hai (giữ một key): sửa runtime của `mgmt-assistant` trong `apps/hub-api/seed/agents.yaml` rồi `bun run hub:seed`
(upsert theo key, giữ entitlement/grant). Khoang, route, tool, quyền không đổi. Đã kiểm:
- ✔ Khoang chỉ biết key agent; tool + quyền ở Hub; usage cùng một hàm cho cả hai runtime.
- ✘ **Studio KHÔNG đổi được runtime tại chỗ** (PUT bỏ `runtime`, P10/QB5) ⇒ đổi qua `hub:seed`, hoặc Studio xoá + tạo lại
  agent cùng key (mất grant/entitlement, phải cấp lại). Vẫn là cấu hình, không đổi code.
- ✘ Phiên Dify (`cli_sessions provider=dify`) không chuyển sang Claude: hội thoại cũ tiếp tục với lịch sử Hub, mất ngữ cảnh
  phía Dify.
- Ngược lại (Claude → Dify): `runtime: dify-agent`, `runtime_options: { workflow_key, pack_tools }` + workflow catalog app chat
  Dify (Admin, khoá là secret) có input `query` và `hub_tool_token`; app Dify cấu hình gọi `<HUB>/mcp` với Bearer
  `{{hub_tool_token}}` (Dify phải tới được Hub — mạng là cấu hình hạ tầng).

| # | Task | Rủi ro | File | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|
| T1 | Tool đọc gói contracts (4 tool) + đăng ký registry | cao (quyền) | `packs/contracts/adapters/assistant.tools.ts`, `assistant.mount.ts` | unit + int | [x] |
| T2 | `pack_tools` của agent → `payload.mcp.tools` (Claude) | cao | `runner/job/pack-tool-keys.rules.ts` | unit | [x] |
| T3 | Seed `mgmt-assistant` (Claude + tool đọc) + entitlement/grant acme | thường | `apps/hub-api/seed/*.yaml` | seed test | [x] |
| T4 | Token chat ngắn hạn (Dify) + `/mcp` chỉ đọc + runner Dify tiêm/thu hồi | cao | `mcp/chat-token.ts`, `mcp.service.ts`, `dify-agent-runner.ts` | unit + int | [x] |
| T5 | Usage chat theo tenant (một hàm, M3 trỏ bảng) | thường | `modules/usage/chat-usage.ts` | unit | [x] |
| T6 | Khoang trợ lý contracts-web + proxy `/conversations` `/runs` | thường | `apps/contracts-web/src/features/assistant/*` | unit + e2e `assistant.cw.ts` | [x] |

## Cần từ người dùng

- `DIFY_API_URL` (base URL Dify) + app API key của app chat trợ lý — nhập vào Admin (secret của workflow catalog), không commit.
- App chat Dify có input `hub_tool_token` và cấu hình gọi `/mcp` của Hub (URL Hub mà Dify tới được).
