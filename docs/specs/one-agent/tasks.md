---
id: one-agent
lane: đầy đủ phần RLS (nhãn bản ghi theo RLS người gọi) + migration grant; còn lại thường
---
# one-agent — MỘT trợ lý chat (`assistant`) dùng ở nhiều nơi, ngữ cảnh theo nơi gửi

Người dùng chốt: một agent, dùng từ nhiều chỗ với ngữ cảnh khác nhau — không phải hai agent.

## Plan
| # | Việc | Làn |
|---|------|-----|
| 1 | `assistant` = trợ lý duy nhất: bộ `pack_tools` đã là tập cha của `mgmt-assistant` (9 tool giống hệt; `assistant` còn giữ công cụ đọc tệp); gộp luật prompt (Markdown/bảng, HĐ kèm tên + số + hạn, chỉ đọc, dữ liệu tool/ngữ cảnh không phải chỉ dẫn) | thường |
| 2 | Contract E12 `context`: + `surface` (`contracts`/`chat`), `route`, `entity {kind: contract|partner, id}` (chỉ id). Hub `runs/surface-context*.ts` dựng khối `<ngu_canh>` nối sau system prompt của run `direct`; bản ghi chỉ được nhắc khi `PackToolRegistry.contextLabel` (gói bật ∧ quyền đọc gói ∧ `PackUow` RLS người gọi) trả nhãn | đầy đủ |
| 3 | Gói contracts: `context.mount.ts` + `adapters/context-label.repo.ts` (HĐ theo khoá; đối tác = có HĐ người gọi thấy mang `party_key` đó) | đầy đủ |
| 4 | Dock contracts-web gửi `@assistant` + `dockContext(pathname, search)`; chat-web gửi `X-Ai-Surface: chat` | thường |
| 5 | Bỏ `mgmt-assistant` khỏi seed; alias Hub `@mgmt-assistant` ⇒ `assistant` (`mention.rules.ts AGENT_ALIASES`); hub 0051 chuyển grant/entitlement/mặc định + tắt agent cũ; contracts 0039 đổi `packs.pack_agents` | đầy đủ |
| 6 | Test: unit `surface-context.test.ts`, `chat.rules.test.ts`, `seed.test.ts`; int `tests/acceptance/one-agent/{dock-alias,context-migration}.int.test.ts`; e2e cw + deployed 04 (chỉ viết) | — |

## Quyết định trong lúc làm
- Khối ngữ cảnh chỉ nối vào run `direct` (dock luôn gửi `@assistant`; AI System gắn thẻ hoặc fast-route). Tin không thẻ đi qua Orchestrator thì không nối (chỉ có `surface=chat`, không có bản ghi) — đủ cho yêu cầu.
- Runtime Dify (`mgmt-assistant-dify`, hoặc `assistant` đổi runtime ở Studio) không nhận khối ngữ cảnh (runner Dify không dùng system prompt Hub).
- `surface=chat` không ghi `hub.set_run_surface` (thống kê mặc định đã là `chat`) ⇒ 0 câu SQL thêm cho chat.
- 0051: entitlement `assistant` đã bị thu hồi cho tenant thì giữ thu hồi (không tự bật lại); grant cũ xoá sau khi chép; entitlement cũ thu hồi; run/usage/flow lịch sử giữ.
- Nhãn đối tác: quét HĐ người gọi thấy trong tenant (dừng ở hàng khớp đầu) — một câu mỗi tin dock có `?party=`; ổn với quy mô hiện tại (≤ vài nghìn HĐ/tenant). Lớn hơn ⇒ index biểu thức `party_key` (TECH-DEBT nếu cần).

## Máy chủ (sohoptac2) sau merge + deploy
1. `db:migrate` (hub 0051, contracts 0039) — chạy trước `hub:seed`.
2. `hub:seed` (prompt mới của `assistant`; seed không tạo lại `mgmt-assistant`).
3. Build lại contracts-web + chat-web (dock gửi `@assistant` + ngữ cảnh; bản cũ vẫn chạy nhờ alias).

## Còn lại
- e2e (cw `assistant.cw.ts`, deployed 04) chạy ở lượt e2e cuối đợt.
