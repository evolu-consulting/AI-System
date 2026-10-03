# Gate C1 — Chat UI + contract + mock Hub

Ngày: 2026-10-04 · Trạng thái: **CHỜ NGƯỜI DÙNG DUYỆT** · Readiness: READY sau xử lý (`C1-chat-ui/readiness.md`, 2 lần)

Không tự duyệt (Luật 2b): có ADR thêm thư viện mới (ADR-0006) và một câu hỏi phạm vi UI (H2).

## 1. Phạm vi
`apps/chat-web` (Rsbuild + React + Tailwind + shadcn, i18n VI/EN, cổng 3100) theo canvas `docs/design/chat-app/canvas/` (Main, FlowOpen, Welcome, States, Mobile); contract Chat↔Hub `@ai/contracts/chat` (zod, strict); mock Hub trong `tools/mocks` (đăng nhập mock JWT EdDSA, hội thoại, flow, run, SSE, `Last-Event-ID`, huỷ, kịch bản `#scn:`); bộ test contract `tests/contract/chat/**` chạy được với `HUB_URL` bất kỳ; e2e `e2e/chat/**`. UC-01…08, CHAT-AC-01…36. Ngoài phạm vi: Hub/Claude CLI thật, Orchestrator, Worker, `/` command, đính kèm, KB, Extension, chat nhóm.

## 2. CR liên quan
CR-018…024 (mốc C1, subscription, Orchestrator là agent, flow, "Consultant", hai ý tưởng hoãn). CR-025/026 (phiên khác): không ảnh hưởng C1.

## 3. Câu hỏi cho người dùng
| # | Câu hỏi | Mặc định |
|---|---|---|
| G1 | Duyệt ADR-0006: `react-markdown` 10.1.0 + `remark-gfm` 4.0.1 + `highlight.js` core 10 ngôn ngữ, nạp lazy (~60 KB gzip, chunk riêng) | Duyệt. Không duyệt → bỏ F12, câu trả lời hiện chữ thô |
| G2 | C1 chỉ giao diện Sáng (canvas chưa có token tối), Tối ghi TECH-DEBT | Chỉ Sáng |

## 4. Test-plan tóm tắt
Contract ≈ 52 ca · unit acceptance ≈ 30 · e2e 37. Khoá `tests/acceptance/**`, `e2e/**`, `tests/contract/**`. Bộ contract chạy riêng `bun run test:contract:chat` (không nằm trong `bun test` gốc).

## 5. Rủi ro
Proxy dev đệm SSE · phiên M4 cùng sửa `packages/contracts/package.json` (1 dòng `exports`) · e2e dùng `/__mock/*` chạy tuần tự · subpath export vướng tooling → fallback package riêng.

## 6. Thứ tự BUILD
B0 → B1 → QB ∥ QA → B2…B6 ∥ F1…F11 → QE → QL (khoá) → F12 (nếu G1 duyệt), F13 → QV Lệnh xong C1 → reviewer (≤ 2 vòng) → docs. Commit theo đường dẫn trên `main`, không đụng file Admin.
