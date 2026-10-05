# modules/mention — tag `@agent` (HUB-FR-91, HUB-BR-18)

Spec H2b-routing (R01–R10); plan §4, §5.1–5.2; chữ ký hàm thuần `plan-rules.md`.

| File | Vai trò |
|---|---|
| `mention-parse.rules.ts` | thuần: `routeMessage` (lệnh `/` → `classifyMessage` nguyên văn · `@@` → chữ bỏ một `@` · `@` → `parseMention` · chữ nguyên văn), `parseMention` (tag lower, gộp trùng; `@` trơn đầu → `empty_tag`) |
| `mention.rules.ts` | thuần: `suggestAgents` (= `suggestCommands`), `firstUnknownTag`, `directText` (`PARTIAL_PREFIX`), `responderOf` (cắt ≤ 100 UTF-16 không tách surrogate) |
| `mention.service.ts` | `prepareMention` (AU → `AGENT_NOT_FOUND{suggestions}` / `CMD_MISSING_ARG{missing:["content"]}` → `MentionPlan` `direct` \| `orchestrated{onlyKeys}`), `MentionService.prepare` (ảnh + nhóm/locale từ cache; tag lạ → `poll` rồi kiểm lại) |

Luồng E12 (`runs/runs.routes.ts`): body → `routeMessage` → lỗi `@` trả JSON **trước** khi tạo run (0 ghi). Thứ tự: hội thoại
(404) → body (400) → `empty_tag` → tag sai đầu tiên → nội dung rỗng → (flow 404/409/429 trong `RunService.start`).

Trạng thái: B4 router + lỗi; kế hoạch run (`direct`, `onlyKeys`) chưa áp — tin tag hợp lệ tạm đi Orchestrator nguyên văn
tới B5/B6 (`direct-driver.ts`).
