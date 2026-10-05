# modules/mention — tag `@agent` (HUB-FR-91, HUB-BR-18)

Spec H2b-routing (R01–R10); plan §4, §5.1–5.2; chữ ký hàm thuần `plan-rules.md`.

| File | Vai trò |
|---|---|
| `mention-parse.rules.ts` | thuần: `routeMessage` (lệnh `/` → `classifyMessage` nguyên văn · `@@` → chữ bỏ một `@` · `@` → `parseMention` · chữ nguyên văn), `parseMention` (tag lower, gộp trùng; `@` trơn đầu → `empty_tag`) |
| `mention.rules.ts` | thuần: `suggestAgents` (= `suggestCommands`), `firstUnknownTag`, `directText` (`PARTIAL_PREFIX`), `responderOf` (cắt ≤ 100 UTF-16 không tách surrogate) |
| `mention.service.ts` | `prepareMention` (AU → `AGENT_NOT_FOUND{suggestions}` / `CMD_MISSING_ARG{missing:["content"]}` → `MentionPlan` `direct` \| `orchestrated{onlyKeys}`), `MentionService.prepare` (ảnh + nhóm/locale từ cache; tag lạ → `poll` rồi kiểm lại) |
| `direct-driver.ts` | `directDriver` (P10): run `direct` = **một** job vai `agent` qua `RoutingRunner` (`agentic-cli` → job `agent.cli`, `dify-*` → `DifyAgentRunner`), không Orchestrator; `prompt` = nội dung R04, `history` = `history_n` của `ctx.orchestrator` (`flowHistoryOf`), `stream=true`; `done` → nội dung · `partial` → `directText` · `need_input` → `ask` + `pending_ask` · lỗi job → `run.failed`; kết thúc `finished` ghi `flows.agent_id` |

Luồng E12 (`runs/runs.routes.ts`): body → `routeMessage` → lỗi `@` trả JSON **trước** khi tạo run (0 ghi). Thứ tự: hội thoại
(404) → body (400) → `empty_tag` → tag sai đầu tiên → nội dung rỗng → (flow 404/409/429 trong `RunService.start`).

Run `direct` (B6): `RunService.start` ghi `runs.kind='direct'`, `agent_id`, `responder_key/name` (chốt lúc tạo run, P1) —
không `orchestrator_tenant_id`; `run.started.responder`; E10/E11 đọc `responder` từ hàng `runs` (E14 không có). Tin user
lưu nguyên văn (kể cả tag). ≥ 2 tag → Orchestrator thu hẹp (B7). Chuyển tiếp `job.delta` là B9.
