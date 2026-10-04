# Plan · H1 · Provider giả `fake-cli` (phụ lục `plan-runtime.md` §7)

Tách khỏi `plan-runtime.md` để giữ trần (WORKFLOW Kỷ luật token #5). Task: PY-09 (provider + registry), PY-10 (`badjson`). Spec §7; test-plan Q-T3, Q-T8.

## 7. Provider giả `fake-cli` (spec §7)
Cùng interface `Provider`, chạy **trong job host** (cùng env, group, hook, cwd). Chỉ nạp khi `APP_ENV ∈ {development, test}` (spec §7); production → bỏ, có trong `AGENT_RT_PROVIDERS` → exit 2.

**Đầu vào `msg`** (Q-T8 — không echo cả prompt, tránh lộ `<agents>`/`<history>`): Orchestrator (`output="text"`) = nội dung khối `<message>` của `prompt` (`plan.md` §6.2); agent (`output="agent_result"`) = `prompt` (= `task`). Chỉ thị đọc từ `msg`.

| Chỉ thị (trong `msg`, nhiều chỉ thị được) | Hành vi tất định |
|---|---|
| (không) | text = `"echo: " + msg_sạch + " " + FAKE_TAIL` (`msg_sạch` = `msg` bỏ mọi `#fake:*`; `FAKE_TAIL` = câu cố định ≥ 120 ký tự, ≥ 3 phần khi Hub cắt `chunkText` 40 ⇒ ≥ 3 `delta`) → `done{text}` (agent) / `answer{text}` (Orchestrator) |
| `#fake:delegate=<key>` | Orchestrator → `delegate{agent: key, task: msg bỏ riêng chỉ thị `#fake:delegate=…`}` (chỉ thị khác như `#fake:sleep` đi tiếp tới agent — S1) |
| `#fake:ask` · `#fake:partial` · `#fake:need_input` | `ask{question}` / `partial{text,missing}` / `need_input{question, choices:["A","B"]}` |
| `#fake:sleep=<s>` | ngủ, `progress` mỗi 1 s (huỷ/timeout) |
| `#fake:spawn-child` | `Popen(["sleep","300"])` cùng group rồi ngủ — AC-W10 |
| `#fake:read=<path>` | qua đúng `sandbox.hook.path_guard` (`tool_name="Read"`, `file_path`); allow → trả độ dài, deny → `done{text:"denied"}` |
| `#fake:tool=<name>` | phát `tool_use{name}` rồi gọi `path_guard` với `tool_name=<name>`, `tool_input={}` và `tools` của job; deny → `done{text:"denied:<reason>"}` (`tool_not_allowed`/`path_not_allowed`), allow → `done{text:"allowed"}` — P19 (Q-T3) |
| `#fake:ratelimit[=<unix_ts>]` | phát `rate_limit{status:"rejected", resets_at}` rồi `final is_error` |
| `#fake:badjson=<n>` | n lần đầu trả JSON hỏng; bộ đếm ở `AGENT_RT_WORK_DIR/.fake-state/<run_id>.json` (`{"badjson": k}`, ghi nguyên tử bằng file tạm + `rename`; mỗi job một process nên không giữ trong bộ nhớ). Agent: n=1 qua nhờ retry; Orchestrator: Hub retry — HUB-H1-AC-10 |
| `#fake:crash` | `os._exit(3)` giữa chừng → `fatal` |
| `#fake:usage=<in>,<out>` | usage giả (mặc định 10,20), `model="fake"` |
| `#fake:remember=<w>` · `recall` · `lost-session` | session giả lưu ở `AGENT_RT_WORK_DIR/.fake-sessions/` (§6) |
| `#fake:env` | trả danh sách **khoá** env (không giá trị) — kiểm §5.3 |

`.fake-state/` và `.fake-sessions/` nằm dưới `AGENT_RT_WORK_DIR` nhưng ngoài `work/<job_id>/`: chỉ code `fake-cli` (Python) đọc/ghi, không qua tool nên hook không áp; cleanup 24 h (§9) dọn như `work/`.
