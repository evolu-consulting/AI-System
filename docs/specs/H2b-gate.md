# Gate H2b — Định tuyến mở rộng (`@agent`, Orchestrator theo tenant, giới hạn run, `delta` từ Runtime) + nợ H1

Ngày: 2026-10-05 · Trạng thái: **ĐÃ DUYỆT 2026-10-05** (người dùng: "Oke") · Readiness: READY (`H2b-routing/readiness.md`, 2 lần)

**Không tự duyệt (Luật 2b):** có CR sửa chữ BA (CR-037) và hành vi lệch câu chữ BA (thứ tự kiểm 429). Không có ADR / thư viện mới (plan P18). Bạn đã chốt U1–U7 và Q1 = B (`spec-decisions.md`).

## 1. Phạm vi (`H2b-routing/spec.md` §1)
- **Gọi thẳng `@agent`:** tag đơn → run `kind=direct` (bỏ qua Orchestrator, 1 step delegate); nhiều tag → Orchestrator chỉ chọn trong các agent được tag; `@@` = chữ `@`; tag sai → 404 `AGENT_NOT_FOUND` + ≤ 3 gợi ý (chỉ trong agent bạn dùng được); tag không nội dung → 422 `CMD_MISSING_ARG`. Lỗi trả trước khi tạo run (không lưu gì).
- **`GET /agents`** (menu `@`): agent dùng được, chỉ `key`, tên vi/en, mô tả; thu hồi → biến mất ≤ 5 s.
- **Tên agent khi tự tag (Q1 = B):** trường tuỳ chọn `responder{key, name}` ở `run.started` và tin trả lời, chỉ run `direct`, tên chốt lúc tạo run.
- **Xác nhận tool `side_effect` cả khi `@agent`:** "Đồng ý" (không tag) hoặc "@đúng-agent Đồng ý" mới chạy; tag agent khác / nhiều tag → huỷ.
- **Orchestrator theo tenant:** bản mặc định + bản riêng mỗi tenant qua seed yaml (`orchestrator_tenants`, xoá bằng `remove: true`); chọn lúc tạo run, chốt vào run; bản riêng hỏng → dùng mặc định + log.
- **Giới hạn run đồng thời mỗi user:** `HUB_MAX_CONCURRENT_RUNS` (mặc định 2) → 429 `TOO_MANY_RUNS` + `Retry-After: 5`.
- **Câu trả lời dài hiện dần:** Runtime phát `delta` (Claude SDK partial messages; `fake-cli` `#fake:stream`), Hub chuyển tiếp ngay khi chắc là câu trả lời cuối; agent `dify-*` cũng stream.
- **Nợ H1:** F3 fixture `lan` vào `beta-testers` · F4 bị từ chối (0 token) → gợi ý "diễn đạt lại" thay vì "thử lại" · F5 job huỷ/timeout vẫn ghi usage đã tốn · F7 `HUB_LIVE=1` thành bộ smoke tự động. Dọn TD #44 (tách thư mục con), #47 (`fake-cli` delegate lại).
- **Không làm:** API/Studio sửa Orchestrator + vế `tenant_admin` của AC-H16 (H4); bộ câu kiểm thử định tuyến (H4); quota, `/agent-grants` (H3); đính kèm (H2c); `llm`/`python`/Gateway/Codex/Gemini (H2d); sửa `apps/chat-web`, Admin, test khoá C1.

## 2. Cần bạn duyệt
| Mục | Nội dung |
|---|---|
| **CR-037 (sửa chữ BA)** | Áp vào BA sau Gate: (1) Run có 3 loại `command`/`orchestrated`/`direct`; (2) kiểm `TOO_MANY_RUNS` **sau** Router và sau `FLOW_BUSY` (BA §5 đặt 429 trước — lỗi gõ sai báo trước, không mở transaction cho tin sai); (3) agent đang là Orchestrator ở **bất kỳ** phạm vi nào không vào menu `@`, không tag/delegate được; (4) tới H4 bản Orchestrator tenant chỉ xoá qua seed `remove: true`; (5) WRK-FR-03: chỉ job có thể là câu trả lời cuối mới phát `delta`, Hub cắt ≤ 40 ký tự, đã phát không rút lại |
| **Q1 = B (đã chốt)** | Làm đúng như bạn chọn: `responder` tuỳ chọn, chỉ run `direct`, contract chat chỉ thêm (khoá `agent` vẫn cấm). ROADMAP ghi "chỉ `GET /agents` + mã lỗi" sẽ sửa ở I3 |
| **Contract chat (U6, sửa thẳng, chỉ thêm)** | `chat/agents.ts` (menu), hằng **riêng** `CHAT_ROUTING_ERRORS {AGENT_NOT_FOUND 404, TOO_MANY_RUNS 429}`, `Retry-After`, `responder?`. Không đổi/xoá trường, không sự kiện SSE mới, không thêm vào `CHAT_API_ERRORS` (test khoá C1 đếm 6 mã) |
| **Khác bản spec draft (readiness)** | F4: đăng nhập hết hạn giữ mã H1 `ALL_PROVIDERS_EXHAUSTED` (không đổi sang `NOT_CONFIGURED` như draft) vì H1 đã phân loại cùng mẫu — một tình huống một mã; chỉ thêm ca "bị từ chối" (`refused`). Giới hạn run: app dựng không truyền giới hạn (test khoá H1/H2a) = không giới hạn; server thật luôn đọc env (mặc định 2) |
| Không quyết định nào của bạn bị làm khác cách đã chọn | U1–U7, Q1 giữ nguyên |

## 3. Contract / dữ liệu
`plan.md` §2 (chat chỉ thêm; hub `JobDeltaEvent{kind, text ≤ 4000}` vào `RunEvent`, `AgentCliJob.stream?`, reason `refused`, sinh lại pydantic), §2.3 endpoint (`GET /agents`; E12 thêm 404/422/429 JSON trước khi tạo run, thứ tự R18). `plan-db.md`: migration `0006_h2b_routing.sql` — `runs` + `direct`, `agent_id`, `orchestrator_tenant_id`, `responder_*`, index đếm run đang chạy; `orchestrator_settings` thêm `tenant_id` (hàng mặc định giữ `id=1`); `jobs.error_reason` + `refused`; không bảng mới, RLS không đổi. `plan-errors.md` (mã, câu chữ, trace), `plan-rules.md` (hàm thuần cho qc), `plan-runtime.md` (Python: bộ phân tích JSON tăng dần, gom 200 ký tự/100 ms, F4, F5, `fake-cli`).

## 4. Test (`test-plan.md`, `test-plan-cases.md`, `test-plan-py.md`)
≈ 210 ca mới: hàm thuần TS ~95 dòng bảng (R01–R44), int hub-api ~92 (A01–A150), Python ~35 (P01–P09 unit, P20–P28 int), stack 8 (S01–S08), hub-dev 1 (H01), perf 3 (không chặn), smoke `HUB_LIVE` 3 (không chặn, không khoá); chạy lại test khoá C1, M1–M4, H1, H2a và 41 ca contract chat với Hub thật. Khoá 3 đợt: Q2 (TS) → Q-PU (unit Python, trước PY-01) → Q3 (Python int + stack + hub-dev, trước PY-03). Lệnh xong `done:h2b` (kế thừa mọi bước `done:h2a`).

## 5. Rủi ro / phụ thuộc
- **Spike PY-S2 (Claude CLI thật trong WSL, đầu mốc, ≤ 6 lượt model):** CLI/SDK có stream `StructuredOutput` không, thứ tự khoá `status`/`decision` trước `text`, usage từng lượt. ✗ → tự lùi: agent không stream (chỉ Orchestrator/`fake`/Dify), ghi TECH-DEBT — **không** chặn mốc, báo lại bạn ở kết quả spike.
- **429 với bộ contract chat:** 41 ca chạy với Hub thật có thể chạm ngưỡng 2 → hub-dev đặt 20 cho stack contract, **không sửa test**; stack H1/H2a (server thật, mặc định 2) đỏ do 429 → script stack đặt 20. Stack H2b luôn đặt 2.
- **Khoá theo user / deadlock:** đếm run nằm trong transaction tạo run, khoá advisory theo user **đầu tiên** (chỉ E12 lấy) ⇒ không chu trình khoá; kiểm bằng int song song 10 POST × 5 vòng + `lock-order`/A37 H1.
- **Combine Chat/Admin (CR-impact ghi ở I3):** Chat — menu `@` từ `GET /agents`, hiện `responder.name`, lỗi `AGENT_NOT_FOUND`/`TOO_MANY_RUNS` (+ `Retry-After`, đã thêm vào CORS expose), `delta` có thể đến khi step còn mở. Admin — bản Orchestrator theo tenant hiện chỉ qua seed (Studio ở H4).
- F4 mẫu chữ lệch thực tế → về `UPSTREAM_ERROR` như H1 (smoke `HUB_LIVE` kiểm).

## 6. Thứ tự BUILD sau duyệt
Gate → C1 ∥ C2 ∥ D1 (∥ PY-S2, MK, F3) → B0 (TD #44 + stub) → qc QW-R → QW-A1 → QW-A2 → **Q2** → QW-PU → **Q-PU** → B1 → (B2, B3, B4 → B5 → B6 → B7 → B8; B6 → B9 → B10; B11 sau B6) ∥ PY-01 → PY-02 → qc QW-P → **Q3** → PY-03 → PY-04 → `done:h2b` (I1) → smoke `HUB_LIVE` (I2) → review (≤ 2 vòng) → docs (I3). Trên `main`, không push.
